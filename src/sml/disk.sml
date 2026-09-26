(* Bounded reads and atomic sibling replacement, shared by sessions and journals. *)
structure Disk =
struct
  exception Invalid of string
  fun exists p = OS.FileSys.access (p, [])
  fun read (path, limit) =
    let val () = if Posix.FileSys.ST.isReg (Posix.FileSys.stat path) then ()
                 else raise Invalid "expected a regular file"
        val stream = BinIO.openIn path
        val bytes = (BinIO.inputN (stream, limit + 1) handle e => (BinIO.closeIn stream; raise e))
        val () = BinIO.closeIn stream
    in if Word8Vector.length bytes > limit then raise Invalid "file exceeds the storage limit"
       else Byte.bytesToString bytes end
  val serial = ref 0
  val privateMode = Posix.FileSys.S.flags [Posix.FileSys.S.irusr, Posix.FileSys.S.iwusr]
  fun syncDirectory path =
    let val fd = Posix.FileSys.openf (path, Posix.FileSys.O_RDONLY, Posix.FileSys.O.flags [])
    in (Posix.IO.fsync fd; Posix.IO.close fd) handle e => (Posix.IO.close fd; raise e) end
  fun atomic (path, text) =
    let val () = serial := !serial + 1
        val temp = OS.Path.concat (OS.Path.dir path, ".pending-" ^
          SysWord.toString (Posix.Process.pidToWord (Posix.ProcEnv.getpid ())) ^ "-" ^ Int.toString (!serial))
        val fd = Posix.FileSys.createf (temp, Posix.FileSys.O_WRONLY, Posix.FileSys.O.flags [Posix.FileSys.O.excl], privateMode)
        val bytes = Byte.stringToBytes text
        val closed = ref false
        fun write i = if i = Word8Vector.length bytes then () else
          let val n = Posix.IO.writeVec (fd, Word8VectorSlice.slice (bytes, i, NONE))
          in if n = 0 then raise Invalid "write made no progress" else write (i + n) end
        fun cleanup () = ((if !closed then () else Posix.IO.close fd) handle _ => ();
                          OS.FileSys.remove temp handle _ => ())
        fun finish () = (write 0; Posix.IO.fsync fd; Posix.IO.close fd; closed := true;
                        OS.FileSys.rename {old = temp, new = path}; syncDirectory (OS.Path.dir path))
    in finish () handle e => (cleanup (); raise e) end
  fun remove path = if exists path then (OS.FileSys.remove path; syncDirectory (OS.Path.dir path)) else ()
end
