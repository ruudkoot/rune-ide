(* Filesystem policy belongs to SML. The host only provides a chosen path. *)
structure Workspace =
struct
  exception Invalid of string
  val root : string option ref = ref NONE
  val hidden = [".git", ".rune", ".rune-ide", "node_modules", ".tools", "build", "out", ".webpack"]
  fun current () = case !root of SOME p => p | NONE => raise Invalid "open a folder first"
  fun inside p = let val r = current () in p = r orelse String.isPrefix (if String.isSuffix "/" r then r else r ^ "/") p end
  fun resolve path = let val p = OS.FileSys.fullPath path in if inside p then p else raise Invalid "path is outside the workspace" end
  fun describe p = Json.Object [("path", Json.String p), ("name", Json.String (OS.Path.file p))]
  fun openFolder p =
    let val path = OS.FileSys.fullPath p
    in if OS.FileSys.isDir path then (root := SOME path; describe path) else raise Invalid "workspace must be a directory" end
  fun listDirectory (path, showExcluded) =
    let
      val path = resolve path
      val dir = OS.FileSys.openDir path
      fun entry name =
        let val p = OS.Path.concat (path, name)
            val link = OS.FileSys.isLink p
            val isDir = (OS.FileSys.isDir p handle OS.SysErr _ => false)
        in (isDir, name, Json.Object [("path", Json.String p), ("name", Json.String name),
              ("directory", Json.Bool isDir), ("symlink", Json.Bool link)]) end
      fun read acc = case OS.FileSys.readDir dir of
        NONE => acc
      | SOME n => if not showExcluded andalso (String.isPrefix "." n orelse List.exists (fn x => x = n) hidden)
                  then read acc else read (entry n :: acc)
      val entries = (read [] handle e => (OS.FileSys.closeDir dir; raise e))
      val () = OS.FileSys.closeDir dir
      fun precedes ((ad, an, _), (bd, bn, _)) = if ad <> bd then ad else String.compare (an, bn) = LESS
      fun merge ([], ys) = ys | merge (xs, []) = xs
        | merge (x :: xs, y :: ys) = if precedes (x, y) then x :: merge (xs, y :: ys) else y :: merge (x :: xs, ys)
      fun sort [] = [] | sort [x] = [x] | sort xs =
        let val n = List.length xs div 2 in merge (sort (List.take (xs, n)), sort (List.drop (xs, n))) end
    in Json.Array (List.map (fn (_, _, v) => v) (sort entries)) end
end
