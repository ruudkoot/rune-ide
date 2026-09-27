(* Filesystem mutations and their document consequences are one SML operation. *)
structure FileOps =
struct
  exception Invalid of string
  fun under (parent, path) = path = parent orelse String.isPrefix (parent ^ "/") path
  fun exists path = (Posix.FileSys.lstat path; true) handle OS.SysErr _ => false
  fun name s =
    let val base = String.map Char.toUpper (hd (String.fields (fn c => c = #".") s))
        val reserved = ["CON", "PRN", "AUX", "NUL"] @ List.tabulate (9, fn i => "COM" ^ Int.toString (i + 1)) @ List.tabulate (9, fn i => "LPT" ^ Int.toString (i + 1))
    in if s = "" orelse s = "." orelse s = ".." orelse String.isSuffix "." s orelse String.isSuffix " " s orelse
       List.exists (fn c => List.exists (fn bad => c = bad) (String.explode "/\\<>:\"|?*") orelse Char.ord c < 32) (String.explode s)
       orelse List.exists (fn word => base = word) reserved
       then raise Invalid "enter a portable file or folder name, without separators or reserved characters" else s end
  fun destination (parent, leaf) =
    let val dir = Workspace.resolve parent
        val () = if OS.FileSys.isDir dir then () else raise Invalid "parent must be a directory"
        val path = OS.Path.concat (dir, name leaf)
        val () = if under (OS.Path.concat (Workspace.current (), ".rune-ide"), path) then raise Invalid "the IDE's build and trash directory is protected" else ()
    in if exists path then raise Invalid "destination already exists" else path end
  fun source path =
    let val () = if OS.FileSys.isLink path then raise Invalid "file operations on symbolic links are not supported" else ()
        val p = Workspace.resolve path
    in if p = Workspace.current () orelse under (OS.Path.concat (Workspace.current (), ".rune-ide"), p)
       then raise Invalid "the workspace root and IDE storage are protected" else p end
  fun affected path = List.filter (fn (d : Documents.document) => under (path, #path d)) (!Documents.documents)
  fun check path =
    let val docs = affected path
        val () = if List.exists Documents.dirty docs then raise Invalid "save or close unsaved editors before renaming or deleting" else ()
        val () = List.app Documents.checkDisk docs
        val pending = Json.array (Session.summaries ())
    in if List.exists (fn d => under (path, Json.getString d "path")) pending
       then raise Invalid "restore or discard recovery buffers before renaming or deleting" else docs end
  fun writeNew (path, text) =
    let val fd = Posix.FileSys.createf (path, Posix.FileSys.O_WRONLY, Posix.FileSys.O.flags [Posix.FileSys.O.excl],
          Posix.FileSys.S.flags [Posix.FileSys.S.irusr, Posix.FileSys.S.iwusr, Posix.FileSys.S.irgrp, Posix.FileSys.S.iroth])
        val bytes = Byte.stringToBytes text
        val closed = ref false
        fun write i = if i = Word8Vector.length bytes then () else
          let val n = Posix.IO.writeVec (fd, Word8VectorSlice.slice (bytes, i, NONE))
          in if n = 0 then raise Invalid "write made no progress" else write (i + n) end
    in (write 0; Posix.IO.fsync fd; Posix.IO.close fd; closed := true; Disk.syncDirectory (OS.Path.dir path))
       handle e => ((if !closed then () else Posix.IO.close fd) handle _ => (); OS.FileSys.remove path handle _ => (); raise e) end
  fun copy params =
    let val () = Build.idle ()
        val path = destination (Json.getString params "parent", Json.getString params "name")
        val (text, bom) = case Json.field params "recoveryId" of
          Json.String id => let val data = Session.find id in (Json.getString data "text", Json.field data "bom" = Json.Bool true) end
        | _ => let val d = Documents.checked params in (!(#text d), !(#bom d)) end
        val () = Documents.validate text
        val () = writeNew (path, (if bom then Documents.bom else "") ^ text)
    in Json.Object [("path", Json.String path)] end
  fun create params =
    let val () = Build.idle ()
        val path = destination (Json.getString params "parent", Json.getString params "name")
        val directory = Json.field params "directory" = Json.Bool true
        val () = if directory then OS.FileSys.mkDir path else writeNew (path, "")
        val () = Disk.syncDirectory (OS.Path.dir path)
    in Json.Object [("path", Json.String path), ("directory", Json.Bool directory)] end
  fun rename params =
    let val () = Build.idle ()
        val old = source (Json.getString params "path")
        val target = destination (OS.Path.dir old, Json.getString params "name")
        val _ = check old
        val () = OS.FileSys.rename {old = old, new = target}
        val () = Disk.syncDirectory (OS.Path.dir old)
        fun move (d : Documents.document) : Documents.document =
          if under (old, #path d) then {path = target ^ String.extract (#path d, String.size old, NONE),
            text = #text d, saved = #saved d, revision = #revision d, bom = #bom d} else d
        val () = Documents.documents := List.map move (!Documents.documents)
    in Json.Object [("oldPath", Json.String old), ("path", Json.String target)] end
  val serial = ref 0
  fun privateDirectory parent leaf =
    let val dir = OS.Path.concat (parent, leaf)
        val () = if exists dir then () else OS.FileSys.mkDir dir
        val () = if OS.FileSys.isLink dir orelse Workspace.resolve dir <> dir orelse not (OS.FileSys.isDir dir)
                 then raise Invalid "IDE storage must be an ordinary workspace directory" else ()
    in dir end
  fun delete params =
    let val () = Build.idle ()
        val old = source (Json.getString params "path")
        val _ = check old
        val trash = privateDirectory (privateDirectory (Workspace.current ()) ".rune-ide") "trash"
        fun fresh () =
          let val () = serial := !serial + 1
              val leaf = IntInf.toString (Time.toMilliseconds (Time.now ())) ^ "-" ^ Int.toString (!serial)
              val dir = OS.Path.concat (trash, leaf)
          in if exists dir then fresh () else (OS.FileSys.mkDir dir; dir) end
        val dir = fresh ()
        val contents = OS.Path.concat (dir, "contents")
        val () = OS.FileSys.mkDir contents
        val target = OS.Path.concat (contents, OS.Path.file old)
        val () = Disk.atomic (OS.Path.concat (dir, "restore.json"), Json.encode (Json.Object [("version", Json.int 1), ("original", Json.String old), ("stored", Json.String target)]))
        val () = OS.FileSys.rename {old = old, new = target}
        val () = Disk.syncDirectory contents
        val () = Disk.syncDirectory dir
        val () = Disk.syncDirectory (OS.Path.dir old)
        val () = Documents.documents := List.filter (fn (d : Documents.document) => not (under (old, #path d))) (!Documents.documents)
    in Json.Object [("path", Json.String old), ("trashPath", Json.String target)] end
end
