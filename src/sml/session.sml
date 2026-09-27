(* Durable application state belongs to SML. Dockview's versioned layout is opaque. *)
structure Session =
struct
  exception Invalid of string
  val directory : string option ref = ref NONE
  val workspace = ref Json.Null
  val view = ref Json.Null
  val settings = ref (Json.Object [])
  val defaultToolchain = ref ""
  val warnings : string list ref = ref []
  type draft = {id : string, data : Json.value, size : int}
  val drafts : draft list ref = ref []
  val offered : string list ref = ref []
  val next = ref 0
  val maxJournal = 16 * 1024 * 1024
  val maxDraft = 4 * 1024 * 1024
  fun warn s = warnings := s :: !warnings
  fun record (ws, v, opts) = Json.Object [("version", Json.int 1), ("workspace", ws), ("view", v), ("settings", opts)]
  fun persist (ws, v, opts) =
    case !directory of NONE => ()
    | SOME dir => Disk.atomic (OS.Path.concat (dir, "session.json"), Json.encode (record (ws, v, opts)))
  fun checkView value =
    if String.size (Json.encode value) > 256 * 1024 then raise Invalid "session layout exceeds 256 KiB"
    else if value = Json.Null orelse Json.field value "version" = Json.int 1 then value
    else raise Invalid "unsupported layout schema"
  fun checkSettings value =
    let fun field k = (k, if k = "toolchain" andalso Json.field value k = Json.String (!defaultToolchain) then Json.Null else Json.field value k)
        fun optionalString k = case Json.field value k of Json.Null => () | Json.String s =>
              if String.size s <= 4096 then () else raise Invalid "setting is too long"
            | _ => raise Invalid ("expected string setting: " ^ k)
        val () = List.app optionalString ["target", "toolchain"]
        val () = case Json.field value "showExcluded" of Json.Null => () | Json.Bool _ => ()
                 | _ => raise Invalid "showExcluded must be a boolean"
    in Json.Object (List.map field ["target", "toolchain", "showExcluded"]) end
  fun setWorkspace path =
    let val ws = Json.String path
        val v = if ws = !workspace then !view else Json.Null
        val () = persist (ws, v, !settings)
    in workspace := ws; view := v end
  fun save params =
    let val () = if Json.field params "workspace" = Json.Null orelse Json.field params "workspace" = !workspace then () else raise Invalid "session workspace changed"
        val v = checkView (Json.field params "view")
        val opts = checkSettings (Json.field params "settings")
        val () = persist (!workspace, v, opts)
    in view := v; settings := opts; Json.Null end
  fun setToolchain path =
    let val opts = Json.Object [("toolchain", if path = !defaultToolchain then Json.Null else Json.String path), ("target", Json.field (!settings) "target"),
                               ("showExcluded", Json.field (!settings) "showExcluded")]
        val () = persist (!workspace, !view, opts)
    in settings := opts end
  fun validateDraft data =
    let val () = if Json.getInt data "version" = 1 then () else raise Invalid "unsupported recovery schema"
        val path = Json.getString data "path"
        val ws = Json.getString data "workspace"
        val () = if OS.Path.isAbsolute path andalso OS.Path.isAbsolute ws then () else raise Invalid "recovery paths must be absolute"
        val text = Json.getString data "text"
        val saved = Json.getString data "saved"
        val () = if String.size text <= 512 * 1024 andalso String.size saved <= 512 * 1024 then () else raise Invalid "recovery text exceeds the document limit"
        val () = case Json.field data "bom" of Json.Bool _ => () | _ => raise Invalid "invalid recovery BOM"
        val _ = Json.getInt data "revision"
    in () end
  fun initialize path =
    let val () = if Disk.exists path then () else (OS.FileSys.mkDir path; Posix.FileSys.chmod (path, Posix.FileSys.S.irwxu))
        val dir = OS.FileSys.fullPath path
        val () = directory := SOME dir
        val file = OS.Path.concat (dir, "session.json")
        fun readSession () =
          let val value = Json.parse (Disk.read (file, 512 * 1024))
              val () = if Json.getInt value "version" = 1 then () else raise Invalid "unsupported session schema"
              val ws = Json.field value "workspace"
              val () = case ws of Json.Null => () | Json.String _ => () | _ => raise Invalid "invalid session workspace"
              val v = checkView (Json.field value "view")
              val opts = checkSettings (Json.field value "settings")
          in workspace := ws; view := v; settings := opts end
        val () = if Disk.exists file then
          (readSession () handle _ =>
            let val backup = file ^ ".unreadable-" ^ IntInf.toString (Time.toMilliseconds (Time.now ()))
            in OS.FileSys.rename {old = file, new = backup}; warn ("Cannot read the previous session; preserved at " ^ backup) end) else ()
        val stream = OS.FileSys.openDir dir
        val loadedBytes = ref 0
        val loadedCount = ref 0
        val skipped = ref false
        fun read () = case OS.FileSys.readDir stream of NONE => () | SOME name =>
          (if String.isPrefix "buffer-" name andalso String.isSuffix ".json" name then
             (if !loadedCount >= 64 orelse !loadedBytes >= maxJournal then skipped := true
              else (let val raw = Disk.read (OS.Path.concat (dir, name), maxDraft)
                   val data = Json.parse raw
                   val () = validateDraft data
                   val size = String.size raw
               in if !loadedBytes + size > maxJournal then skipped := true else
                    (drafts := {id = name, data = data, size = size} :: !drafts; offered := name :: !offered;
                     loadedCount := !loadedCount + 1; loadedBytes := !loadedBytes + size) end)
              handle _ => warn ("Unreadable recovery file preserved: " ^ OS.Path.concat (dir, name)))
           else if String.isPrefix ".pending-" name then
             (* Incomplete writes never supersede the last committed record. *)
             (OS.FileSys.remove (OS.Path.concat (dir, name)) handle _ => ())
           else (); read ())
        val () = (read () handle e => (OS.FileSys.closeDir stream; raise e))
        val () = OS.FileSys.closeDir stream
        val () = if !skipped then warn ("Recovery exceeds 64 buffers / 16 MiB; additional records are preserved in " ^ dir ^ ". Save or discard offered buffers and restart to load more.") else ()
    in () end
  fun same (ws, path) (d : draft) = Json.field (#data d) "workspace" = Json.String ws andalso Json.field (#data d) "path" = Json.String path
  fun pending (ws, path) = List.exists (fn (d : draft) => same (ws, path) d andalso List.exists (fn id => id = #id d) (!offered)) (!drafts)
  fun activate (ws, path) =
    offered := List.filter (fn id => not (List.exists (fn (d : draft) => #id d = id andalso same (ws, path) d) (!drafts))) (!offered)
  fun forget (ws, path) =
    let val matches = List.filter (same (ws, path)) (!drafts)
        val () = case !directory of NONE => () | SOME dir =>
          List.app (fn (d : draft) => Disk.remove (OS.Path.concat (dir, #id d))) matches
    in activate (ws, path); drafts := List.filter (fn d => not (same (ws, path) d)) (!drafts) end
  fun putWith preserve (ws, path, text, saved, revision, bom) =
    if text = saved andalso not preserve then forget (ws, path)
    else case !directory of NONE => () | SOME dir =>
      let val data = Json.Object [("version", Json.int 1), ("workspace", Json.String ws),
             ("path", Json.String path), ("text", Json.String text), ("saved", Json.String saved),
             ("revision", Json.int revision), ("bom", Json.Bool bom)]
          val raw = Json.encode data
          val rest = List.filter (fn d => not (same (ws, path) d)) (!drafts)
          val total = List.foldl (fn (d : draft, n) => n + #size d) (String.size raw) rest
          val () = if total > maxJournal orelse List.length rest >= 64 then raise Invalid "recovery storage is full (64 buffers / 16 MiB); save or discard some buffers" else ()
          fun fresh () =
            let val () = next := !next + 1 val name = "buffer-" ^ Int.toString (!next) ^ ".json"
            in if Disk.exists (OS.Path.concat (dir, name)) then fresh () else name end
          val existing = List.find (same (ws, path)) (!drafts)
          val id = case existing of SOME d => #id d | NONE => fresh ()
          val unchanged = case existing of SOME d => #data d = data | NONE => false
          val () = if unchanged then () else Disk.atomic (OS.Path.concat (dir, id), raw)
      in drafts := {id = id, data = data, size = String.size raw} :: rest end
  fun put args = putWith false args
  fun retain args = putWith true args
  fun find id = case List.find (fn (d : draft) => #id d = id) (!drafts) of
    SOME d => #data d | NONE => raise Invalid "recovery buffer no longer exists"
  fun discard id =
    let val () = if List.exists (fn candidate => id = candidate) (!offered) then () else raise Invalid "buffer is already active; close its editor to discard it"
        val data = find id
    in forget (Json.getString data "workspace", Json.getString data "path"); Json.Null end
  fun summaries () = Json.Array (List.map (fn (d : draft) => Json.Object [
    ("id", Json.String (#id d)), ("workspace", Json.field (#data d) "workspace"),
    ("path", Json.field (#data d) "path"), ("revision", Json.field (#data d) "revision")])
    (List.filter (fn (d : draft) => List.exists (fn id => id = #id d) (!offered)) (!drafts)))
  fun load () = Json.Object [("version", Json.int 1), ("workspace", !workspace), ("view", !view), ("settings", !settings),
    ("recovery", summaries ()), ("warnings", Json.Array (List.map Json.String (List.rev (!warnings))))]
end
