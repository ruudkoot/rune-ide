(* Build policy and result publication live in SML; Electron only runs a child. *)
structure Build =
struct
  exception Invalid of string
  fun message (Invalid s) = s
    | message (Json.Invalid s) = s
    | message (Documents.Invalid s) = s
    | message (Utf8.Invalid s) = s
    | message (OS.SysErr (s, _)) = s
    | message (IO.Io {name, ...}) = "I/O error on " ^ name
    | message e = General.exnMessage e
  type target = {name : string, sources : string list, output : string, optimization : int, noPrelude : bool}
  type job = {id : int, root : string, target : target, report : string, artifact : string, workId : OS.FileSys.file_id,
              snapshots : (string * string) list, revisions : (string * int) list}
  val active : job option ref = ref NONE
  val lastDiagnostics : Json.value list ref = ref []
  val serial = ref 0
  fun idle () = case !active of NONE => () | SOME _ => raise Invalid "a build is already running"
  fun reset () = (idle (); lastDiagnostics := [])
  fun exists p = OS.FileSys.access (p, [])
  fun strings xs = Json.Array (List.map Json.String xs)
  fun trim s =
    let val n = String.size s
        fun left i = if i < n andalso Char.isSpace (String.sub (s, i)) then left (i + 1) else i
        val a = left 0
        fun right i = if i > a andalso Char.isSpace (String.sub (s, i - 1)) then right (i - 1) else i
    in String.substring (s, a, right n - a) end
  fun validName s = s <> "" andalso List.all (fn c => Char.isAlphaNum c orelse c = #"-" orelse c = #"_") (String.explode s)
  fun source s = if OS.Path.isAbsolute s then raise Invalid "target sources must be workspace-relative paths"
                 else Workspace.resolve (OS.Path.concat (Workspace.current (), s))
  fun target (name, files, output, optimization, noPrelude) : target =
    let val () = if validName name then () else raise Invalid "target name must use letters, digits, hyphens or underscores"
        val () = if List.null files then raise Invalid "target has no sources" else ()
        val () = if OS.Path.file output = output andalso String.isSuffix ".rbc" output
                 then () else raise Invalid "output must be an .rbc filename (written under .rune-ide)"
        val () = if optimization = 0 orelse optimization = 1 then () else raise Invalid "optimization must be 0 or 1"
        fun distinct [] = () | distinct (x :: xs) = if List.exists (fn y => x = y) xs then raise Invalid "duplicate target source" else distinct xs
        val paths = List.map source files
        val () = distinct paths
    in {name = name, sources = paths, output = output, optimization = optimization, noPrelude = noPrelude} end
  fun parseTarget value =
    let val name = Json.getString value "name"
        val files = List.map Json.string (Json.array (Json.field value "sources"))
        val output = case Json.field value "output" of Json.Null => name ^ ".rbc" | v => Json.string v
        val optimization = case Json.field value "optimization" of Json.Null => 1 | v => Json.integer v
    in target (name, files, output, optimization, Json.field value "noPrelude" = Json.Bool true) end
  fun targets params =
    let val root = Workspace.current ()
        val config = OS.Path.concat (root, ".rune-ide.json")
        val manifest = OS.Path.concat (root, "sources.txt")
        val result =
          if exists config then
            let val value = Json.parse (Documents.read (Workspace.resolve config))
            in if Json.getInt value "version" <> 1 then raise Invalid "unsupported .rune-ide.json version"
               else List.map parseTarget (Json.array (Json.field value "targets")) end
          else if exists manifest then
            let val lines = List.filter (fn s => s <> "" andalso not (String.isPrefix "#" s))
                              (List.map trim (String.tokens (fn c => c = #"\n" orelse c = #"\r") (Documents.read (Workspace.resolve manifest))))
            in [target ("workspace", lines, "workspace.rbc", 1, false)] end
          else case Json.field params "activePath" of Json.String path =>
            let val path = Workspace.resolve path
                val relative = OS.Path.mkRelative {path = path, relativeTo = root}
            in [target ("active-file", [relative], "active-file.rbc", 1, false)] end
          | _ => []
        fun names [] = () | names ((t : target) :: rest) =
          if List.exists (fn (other : target) => #name t = #name other) rest then raise Invalid "duplicate target name" else names rest
        val () = names result
    in result end
  fun describe (t : target) = Json.Object [("name", Json.String (#name t)),
    ("sources", strings (#sources t)), ("output", Json.String (#output t))]
  fun list params = Json.Array (List.map describe (targets params))
  fun cleanup (job : job) =
    let val work = OS.Path.dir (#report job)
        val () = if Workspace.resolve work = work andalso not (OS.FileSys.isLink work)
                    andalso OS.FileSys.fileId work = #workId job
                 then () else raise Invalid "build directory identity changed; temporary files retained"
        fun remove path = OS.FileSys.remove path handle e => if exists path then raise e else ()
        val () = List.app remove [#report job, #artifact job]
        val () = OS.FileSys.rmDir work
    in Json.Null end
    handle e => Json.String ("Cannot clean temporary build files in " ^ OS.Path.dir (#report job) ^ ": " ^ message e)
  fun prepare params =
    let val () = idle ()
        val () = Documents.requireClean ()
        val available = targets params
        val name = Json.getString params "target"
        val selected = case List.find (fn (t : target) => #name t = name) available of SOME t => t | NONE => raise Invalid "select an available build target"
        val root = Workspace.current ()
        val toolchain = OS.FileSys.fullPath (Json.getString params "toolchain")
        val vm = OS.Path.concat (toolchain, Platform.vmName ())
        val lib = OS.Path.concat (toolchain, "lib")
        val () = if OS.FileSys.access (vm, [OS.FileSys.A_EXEC]) then () else raise Invalid ("toolchain is missing an executable " ^ Platform.vmName ())
        val () = if #noPrelude selected orelse exists (OS.Path.concat (lib, "basis/MANIFEST")) then () else raise Invalid "toolchain is missing lib/basis/MANIFEST"
        val compiler = OS.FileSys.fullPath (Json.getString params "compiler")
        val () = if exists compiler then () else raise Invalid "compiler adapter is missing; run make compiler"
        val () = List.app Documents.checkDisk (!Documents.documents)
        val snapshots = List.map (fn p => (p, Documents.read p)) (#sources selected)
        val revisions = List.map (fn (d : Documents.document) => (#path d, !(#revision d))) (!Documents.documents)
        val dir = OS.Path.concat (root, ".rune-ide")
        val () = if exists dir then () else OS.FileSys.mkDir dir
        val dir = Workspace.resolve dir
        val () = serial := !serial + 1
        val work = OS.Path.concat (dir, "build-" ^ IntInf.toString (Time.toMilliseconds (Time.now ())) ^ "-" ^ Int.toString (!serial))
        val () = OS.FileSys.mkDir work
        val artifact = OS.Path.concat (work, "output.rbc")
        val report = OS.Path.concat (work, "diagnostics.json")
        val args = ["--heap-size", "536870912", compiler, report, "--lib", lib,
                    "-O" ^ Int.toString (#optimization selected), "-o", artifact]
                   @ (if #noPrelude selected then ["--no-prelude"] else []) @ #sources selected
        val job = {id = !serial, root = root, target = selected, report = report, artifact = artifact, workId = OS.FileSys.fileId work,
                   snapshots = snapshots, revisions = revisions}
    in active := SOME job;
       Json.Object [("id", Json.int (!serial)), ("executable", Json.String vm),
                    ("args", strings args), ("cwd", Json.String root), ("target", describe selected)] end
  fun diagnostic value =
    let val severity = Json.getString value "severity"
        val () = if severity = "error" orelse severity = "warning" then () else raise Invalid "invalid diagnostic severity"
        val message = Json.getString value "message"
        val path = Json.getString value "path"
        val range = Json.field value "range"
        val () = case range of Json.Null => () | _ =>
          let val sl = Json.getInt range "startLineNumber" val sc = Json.getInt range "startColumn"
              val el = Json.getInt range "endLineNumber" val ec = Json.getInt range "endColumn"
          in if sl < 1 orelse sc < 1 orelse el < sl orelse ec < 1 orelse (el = sl andalso ec < sc)
             then raise Invalid "invalid diagnostic range" else () end
    in Json.Object [("severity", Json.String severity), ("message", Json.String message),
                    ("path", Json.String path), ("range", range)] end
  fun generic message = Json.Object [("severity", Json.String "error"), ("message", Json.String message),
                                     ("path", Json.String ""), ("range", Json.Null)]
  fun finish params =
    let val job = case !active of SOME j => j | NONE => raise Invalid "no active build"
        val () = if #id job = Json.getInt params "id" then () else raise Invalid "stale build completion"
        val () = active := NONE
        val cancelled = Json.field params "cancelled" = Json.Bool true
        val exitOK = Json.field params "exitCode" = Json.int 0
        val failure = case Json.field params "failure" of Json.String s => SOME s | _ => NONE
        fun readReport () =
          let val report = Json.parse (Documents.read (#report job))
              val () = if Json.getInt report "version" = 1 then () else raise Invalid "incompatible diagnostic report"
              val success = case Json.field report "success" of Json.Bool b => b | _ => raise Invalid "invalid compiler outcome"
              val () = if success = exitOK then () else raise Invalid "compiler outcome disagrees with its exit status"
              val diagnostics = List.map diagnostic (Json.array (Json.field report "diagnostics"))
              val hasErrors = List.exists (fn d => Json.field d "severity" = Json.String "error") diagnostics
              val () = if success andalso hasErrors then raise Invalid "successful report contains errors" else ()
          in (success, diagnostics) end
        val (success, diagnostics) =
          if cancelled then (false, [])
          else case failure of SOME message => (false, [generic message])
          | NONE => (readReport () handle e => (false, [generic ("Compiler report unavailable or invalid: " ^ message e)]))
        val diagnostics = if not success andalso not cancelled andalso List.null diagnostics
                          then [generic "Compiler failed; see Output for details"] else diagnostics
        fun sameFile (path, text) = (Documents.read path = text handle _ => false)
        fun sameRevision (path, revision) =
          case List.find (fn (d : Documents.document) => #path d = path) (!Documents.documents) of
            NONE => true | SOME d => !(#revision d) = revision andalso not (Documents.dirty d)
        val stale = Workspace.current () <> #root job orelse List.exists Documents.dirty (!Documents.documents)
                    orelse not (List.all sameFile (#snapshots job))
                    orelse not (List.all sameRevision (#revisions job))
        val output = OS.Path.concat (OS.Path.concat (#root job, ".rune-ide"), #output (#target job))
        fun publish () =
          let val dir = Workspace.resolve (OS.Path.dir output)
              val () = if exists output andalso OS.FileSys.isLink output then raise Invalid "artifact output is a symlink" else ()
          in OS.FileSys.rename {old = #artifact job, new = OS.Path.concat (dir, OS.Path.file output)} end
        val publishError = if success andalso not stale andalso not cancelled then
                             (publish (); NONE) handle e => SOME (message e) else NONE
        val state = if cancelled then "cancelled" else if stale then "stale"
                    else if success andalso not (isSome publishError) then "success" else "failed"
        val diagnostics = case publishError of NONE => diagnostics | SOME e => diagnostics @ [generic ("Cannot publish artifact: " ^ e)]
        val () = lastDiagnostics := diagnostics
        val cleanupWarning = cleanup job
    in Json.Object [("id", Json.int (#id job)), ("state", Json.String state),
         ("diagnostics", Json.Array diagnostics), ("output", if state = "success" then Json.String output else Json.Null),
         ("sources", strings (#sources (#target job))), ("cleanupWarning", cleanupWarning)] end
  fun openDiagnostic params =
    let val index = Json.getInt params "index"
        val item = List.nth (!lastDiagnostics, index) handle Subscript => raise Invalid "diagnostic no longer exists"
        val path = Json.getString item "path"
        val () = if path = "" then raise Invalid "diagnostic has no source" else ()
    in if Workspace.inside (OS.FileSys.fullPath path) then Documents.openFile path
       else let val raw = Documents.read path
                val hasBom = String.isPrefix Documents.bom raw
                val text = if hasBom then String.extract (raw, 3, NONE) else raw
                val () = Documents.validate text
            in Json.Object [("path", Json.String path), ("text", Json.String text), ("bom", Json.Bool hasBom),
                            ("readOnly", Json.Bool true), ("revision", Json.int 0), ("dirty", Json.Bool false)] end
    end
end
