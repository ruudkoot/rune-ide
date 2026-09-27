(* Sequential domain requests; compilation is always a separate host child. *)
structure IdeService =
struct
  val initialized = ref false
  val stopping = ref false
  exception Rpc of int * string
  fun dispatch method params =
    if method = "initialize" then
      if Json.getInt params "protocol" <> 1 then raise Rpc (~32001, "incompatible protocol version")
      else if !initialized then raise Rpc (~32002, "service is already initialized")
      else (Session.defaultToolchain := (case Json.field params "defaultToolchain" of Json.String path => path | _ => "");
            case Json.field params "stateDir" of Json.String path => Session.initialize path | _ => ();
            initialized := true; Json.Object [("protocol", Json.int 1), ("implementation", Json.String "Standard ML on Rune")])
    else if not (!initialized) then raise Rpc (~32002, "initialize the service first")
    else case method of
      "ping" => params
    | "shutdown" => (stopping := true; Json.Null)
    | "workspace/open" => (Build.idle (); Documents.requireClean ();
        let val previous = !Workspace.root
            val result = Workspace.openFolder (Json.getString params "path")
            val () = Session.setWorkspace (Workspace.current ())
                     handle e => (Workspace.root := previous; raise e)
        in Documents.reset (); Build.reset (); FileEvents.reset (); result end)
    | "workspace/list" => Workspace.listDirectory (Json.getString params "path", Json.field params "showExcluded" = Json.Bool true)
    | "workspace/watch" => FileEvents.configure params
    | "workspace/changes" => FileEvents.changes ()
    | "file/create" => FileOps.create params
    | "file/copy" => FileOps.copy params
    | "file/rename" => FileOps.rename params
    | "file/delete" => FileOps.delete params
    | "document/open" => Documents.openFile (Json.getString params "path")
    | "document/change" => Documents.change params
    | "document/save" => Documents.save params
    | "document/close" => Documents.closeFile params
    | "document/list" => Documents.list ()
    | "document/attach" => Documents.attach params
    | "document/check" => Documents.inspect params
    | "document/reload" => Documents.reload params
    | "session/load" => Session.load ()
    | "session/save" => Session.save params
    | "session/end" => Documents.endSession ()
    | "session/toolchain" => (Session.setToolchain (Json.getString params "path"); Json.Null)
    | "recovery/restore" => Documents.recover (Json.getString params "id")
    | "recovery/discard" => Session.discard (Json.getString params "id")
    | "build/targets" => Build.list params
    | "build/prepare" => Build.prepare params
    | "build/finish" => Build.finish params
    | "diagnostic/open" => Build.openDiagnostic params
    | _ => raise Rpc (~32601, "unknown method: " ^ method)
  fun result id v = Json.Object [("jsonrpc", Json.String "2.0"), ("id", id), ("result", v)]
  fun error id code message = Json.Object [("jsonrpc", Json.String "2.0"), ("id", id), ("error", Json.Object [("code", Json.int code), ("message", Json.String message)])]
  fun handleRequest request =
    let
      val id = Json.field request "id"
      fun run () =
        if Json.field request "jsonrpc" <> Json.String "2.0" orelse id = Json.Null then raise Rpc (~32600, "expected a JSON-RPC request with id")
        else result id (dispatch (Json.getString request "method") (Json.field request "params"))
    in run () handle Rpc (c, m) => error id c m
       | Json.Invalid m => error id (~32602) m
       | Utf8.Invalid m => error id (~32602) m
       | Workspace.Invalid m => error id (~32010) m
       | Documents.Invalid m => error id (~32020) m
       | Session.Invalid m => error id (~32040) m
       | Disk.Invalid m => error id (~32040) m
       | FileOps.Invalid m => error id (~32050) m
       | Build.Invalid m => error id (~32030) m
       | e => error id (~32000) (General.exnMessage e)
    end
  val maxLine = 4 * 1024 * 1024
  (* Raw descriptor reads return available pipe bytes. Buffered TextIO reads
     can wait for a full block and deadlock an interactive request/reply. *)
  val input = ref ""
  val inputPos = ref 0
  fun inputChar () =
    if !inputPos < String.size (!input) then
      let val c = String.sub (!input, !inputPos) in inputPos := !inputPos + 1; SOME c end
    else
      let val bytes = Posix.IO.readVec (Posix.FileSys.stdin, 4096)
      in input := Byte.bytesToString bytes; inputPos := 0;
         if String.size (!input) = 0 then NONE else inputChar () end
  fun readLine () =
    let fun go (n, chunk, size, chunks) =
      case inputChar () of
        NONE => if n = 0 then NONE else SOME (String.concat (List.rev (String.implode (List.rev chunk) :: chunks)))
      | SOME #"\n" => SOME (String.concat (List.rev (String.implode (List.rev chunk) :: chunks)))
      | SOME c => if n >= maxLine then raise Rpc (~32600, "message too large")
                  else if size = 1024 then go (n + 1, [c], 1, String.implode (List.rev chunk) :: chunks)
                  else go (n + 1, c :: chunk, size + 1, chunks)
    in go (0, [], 0, []) end
  fun emit v = (TextIO.output (TextIO.stdOut, Json.encode v ^ "\n"); TextIO.flushOut TextIO.stdOut)
  fun main () =
    let fun loop () = if !stopping then () else
      case readLine () of NONE => () | SOME line =>
        let val reply = (handleRequest (Json.parse line)
                          handle Json.Invalid m => error Json.Null (~32700) m
                               | Utf8.Invalid m => error Json.Null (~32700) m)
        in emit reply; loop () end
    in loop () handle Rpc (c, m) => (emit (error Json.Null c m); ()) end
end
