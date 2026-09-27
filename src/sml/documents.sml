(* Authoritative text/revision state. Browser edit offsets count UTF-16 units. *)
structure Documents =
struct
  exception Invalid of string
  type document = {path : string, text : string ref, saved : string ref,
                   revision : int ref, bom : bool ref}
  val documents : document list ref = ref []
  val limit = 512 * 1024
  val bom = "\239\187\191"
  fun read path =
    let val () = if Posix.FileSys.ST.isReg (Posix.FileSys.stat path) then ()
                 else raise Invalid "only regular files can be edited"
        val stream = BinIO.openIn path
        val bytes = (BinIO.inputN (stream, limit + 1) handle e => (BinIO.closeIn stream; raise e))
        val () = BinIO.closeIn stream
    in if Word8Vector.length bytes > limit then raise Invalid "file exceeds the 512 KiB editing limit"
       else Byte.bytesToString bytes end
  fun validate text =
    let val () = Utf8.validate text
        val crlf = ref false
        val lf = ref false
        fun go i = if i >= String.size text then () else
          case String.sub (text, i) of
            #"\r" => if i + 1 < String.size text andalso String.sub (text, i + 1) = #"\n"
                      then (crlf := true; go (i + 2)) else raise Invalid "lone CR line endings are not supported"
          | #"\n" => (lf := true; go (i + 1))
          | c => if Char.ord c < 32 andalso c <> #"\t" then raise Invalid "binary/control characters are not supported"
                 else go (i + 1)
        val () = if String.size text <= limit - 3 then go 0 else raise Invalid "document exceeds the editing limit"
    in if !lf andalso !crlf then raise Invalid "mixed line endings are not supported" else () end
  fun dirty (d : document) = !(#text d) <> !(#saved d)
  fun summary (d : document) = Json.Object [("path", Json.String (#path d)),
    ("revision", Json.int (!(#revision d))), ("dirty", Json.Bool (dirty d))]
  fun snapshot (d : document) = case summary d of Json.Object fields =>
      Json.Object (("text", Json.String (!(#text d))) :: ("savedText", Json.String (!(#saved d))) :: ("bom", Json.Bool (!(#bom d))) :: fields)
    | _ => raise Fail "document summary"
  fun find path = case List.find (fn (d : document) => #path d = path) (!documents) of
      SOME d => d | NONE => raise Invalid "document is not open"
  fun openFile path =
    let val path = Workspace.resolve path
    in case List.find (fn (d : document) => #path d = path) (!documents) of
      SOME d => snapshot d
    | NONE => let val () = if Session.pending (Workspace.current (), path) then raise Invalid "This file has recoverable edits. Restore or discard them in the recovery banner first." else ()
                  val raw = read path
                  val hasBom = String.isPrefix bom raw
                  val text = if hasBom then String.extract (raw, 3, NONE) else raw
                  val () = validate text
                  val d = {path = path, text = ref text, saved = ref text, revision = ref 0, bom = ref hasBom}
              in documents := d :: !documents; snapshot d end
    end
  fun checked params =
    let val d = find (Json.getString params "path")
    in if !(#revision d) = Json.getInt params "revision" then d
       else raise Invalid "document revision mismatch; close and reopen the file" end
  fun change params =
    let val d = checked params
        val original = !(#text d)
        fun edit v =
          let val start = Json.getInt v "offset"
              val len = Json.getInt v "length"
              val () = if len < 0 then raise Invalid "negative edit length" else ()
          in (Utf8.byteOffset (original, start), Utf8.byteOffset (original, start + len), Json.getString v "text") end
        (* Descending offsets make simultaneous edits independent of each other. *)
        fun insert (x as (a, _, _), []) = [x]
          | insert (x as (a, _, _), (y as (b, _, _)) :: ys) =
              if a > b then x :: y :: ys else y :: insert (x, ys)
        val edits = List.foldl insert [] (List.map edit (Json.array (Json.field params "changes")))
        fun apply ([], text, _) = text
          | apply ((a, b, text) :: rest, current, boundary) =
              if b > boundary then raise Invalid "overlapping edits"
              else apply (rest, String.substring (current, 0, a) ^ text ^ String.extract (current, b, NONE), a)
        val text = apply (edits, original, String.size original)
        val () = validate text
        val journal = if OS.FileSys.access (#path d, []) then Session.put else Session.retain
        val () = journal (Workspace.current (), #path d, text, !(#saved d), !(#revision d) + 1, !(#bom d))
    in #text d := text; #revision d := !(#revision d) + 1; summary d end
  fun diskText (d : document) text = (if !(#bom d) then bom else "") ^ text
  fun checkDisk (d : document) =
    if Workspace.resolve (#path d) <> #path d orelse read (#path d) <> diskText d (!(#saved d))
    then raise Invalid "file changed on disk; your edits are retained. Close and discard, then reopen to load the disk version"
    else ()
  fun diskState (d : document) =
    ((if Workspace.resolve (#path d) <> #path d then "replaced"
      else if read (#path d) = diskText d (!(#saved d)) then "same" else "changed")
     handle _ => if OS.FileSys.access (#path d, []) then "unreadable" else "missing")
  fun inspect params =
    let val d = checked params
        val state = diskState d
        val args = (Workspace.current (), #path d, !(#text d), !(#saved d), !(#revision d), !(#bom d))
        val () = if state = "missing" then Session.retain args else if state = "same" andalso not (dirty d) then Session.put args else ()
    in Json.Object [("state", Json.String state), ("revision", Json.int (!(#revision d)))] end
  fun reload params =
    let val d = checked params
        val () = if dirty d andalso Json.field params "discard" <> Json.Bool true then raise Invalid "reload would discard unsaved edits" else ()
        val () = if Workspace.resolve (#path d) = #path d then () else raise Invalid "file identity changed; close and reopen it"
        val raw = read (#path d)
        val hasBom = String.isPrefix bom raw
        val text = if hasBom then String.extract (raw, 3, NONE) else raw
        val () = validate text
        val () = Session.forget (Workspace.current (), #path d)
    in #text d := text; #saved d := text; #bom d := hasBom; #revision d := !(#revision d) + 1; snapshot d end
  val serial = ref 0
  fun save params =
    let val d = checked params
        val () = checkDisk d
        val path = #path d
        val mode = Posix.FileSys.ST.mode (Posix.FileSys.stat path)
        val () = if OS.FileSys.access (path, [OS.FileSys.A_WRITE]) then () else raise Invalid "file is read-only"
        val () = serial := !serial + 1
        val temp = path ^ ".rune-ide-" ^ SysWord.toString (Posix.Process.pidToWord (Posix.ProcEnv.getpid ())) ^ "-" ^ Int.toString (!serial)
        val fd = Posix.FileSys.createf (temp, Posix.FileSys.O_WRONLY, Posix.FileSys.O.flags [Posix.FileSys.O.excl], mode)
        val closed = ref false
        fun cleanup () = ((if !closed then () else Posix.IO.close fd) handle _ => ();
                          OS.FileSys.remove temp handle _ => ())
        val bytes = Byte.stringToBytes (diskText d (!(#text d)))
        fun write i = if i = Word8Vector.length bytes then () else
          let val n = Posix.IO.writeVec (fd, Word8VectorSlice.slice (bytes, i, NONE))
          in if n = 0 then raise Invalid "save made no progress" else write (i + n) end
        fun finish () = (write 0; Posix.FileSys.fchmod (fd, mode); Posix.IO.fsync fd;
                        Posix.IO.close fd; closed := true; checkDisk d;
                        OS.FileSys.rename {old = temp, new = path}; Disk.syncDirectory (OS.Path.dir path))
        val () = finish () handle e => (cleanup (); raise e)
    in #saved d := !(#text d); Session.forget (Workspace.current (), #path d); snapshot d end
  fun closeFile params =
    let val d = checked params
        val () = if dirty d andalso Json.field params "discard" <> Json.Bool true
                 then raise Invalid "document has unsaved changes" else ()
        val () = Session.forget (Workspace.current (), #path d)
    in documents := List.filter (fn (other : document) => #path other <> #path d) (!documents); Json.Null end
  fun list () = Json.Array (List.map summary (!documents))
  fun requireClean () = if List.exists dirty (!documents) then raise Invalid "close unsaved documents before changing workspace" else ()
  fun reset () = (requireClean (); documents := [])
  fun endSession () =
    (List.app (fn (d : document) => Session.forget (Workspace.current (), #path d)) (!documents); Json.Null)
  (* Reattach a surviving Monaco model after a service crash. The original
     saved baseline is retained, so a changed disk file still causes a conflict. *)
  fun attach params =
    let val path = Workspace.resolve (Json.getString params "path")
        val text = Json.getString params "text"
        val saved = Json.getString params "savedText"
        val () = validate text
        val () = validate saved
        val hasBom = Json.field params "bom" = Json.Bool true
        val () = if List.exists (fn (d : document) => #path d = path) (!documents) then raise Invalid "document is already attached" else ()
        val alreadySaved = (read path = (if hasBom then bom else "") ^ text handle _ => false)
        val baseline = if alreadySaved then text else saved
        val () = Session.put (Workspace.current (), path, text, baseline, 0, hasBom)
        val () = Session.activate (Workspace.current (), path)
        val d = {path = path, text = ref text, saved = ref baseline, revision = ref 0, bom = ref hasBom}
    in documents := d :: !documents; snapshot d end
  fun recover id =
    let val data = Session.find id
        val () = if Json.getString data "workspace" = Workspace.current () then () else raise Invalid "Open the original workspace before restoring this buffer"
        val path = Workspace.resolve (Json.getString data "path")
        val () = if List.exists (fn (d : document) => #path d = path) (!documents) then raise Invalid "close the open document before restoring its recovery buffer" else ()
        val text = Json.getString data "text"
        val saved = Json.getString data "saved"
        val hasBom = Json.field data "bom" = Json.Bool true
        val () = validate text
        val () = validate saved
        val alreadySaved = (read path = (if hasBom then bom else "") ^ text handle _ => false)
        val baseline = if alreadySaved then text else saved
        val d = {path = path, text = ref text, saved = ref baseline, revision = ref 0, bom = ref hasBom}
        val () = if alreadySaved then Session.forget (Workspace.current (), path)
                 else Session.put (Workspace.current (), path, text, baseline, 0, hasBom)
        val () = Session.activate (Workspace.current (), path)
    in documents := d :: !documents; snapshot d end
end
