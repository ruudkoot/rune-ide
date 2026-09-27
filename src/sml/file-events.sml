(* Notifications are hints. SML compares directory snapshots and bounds rescans. *)
structure FileEvents =
struct
  type watched = {path : string, previous : string ref}
  val watched : watched list ref = ref []
  val excluded = ref false
  fun reset () = watched := []
  fun configure params =
    let val paths = List.map Json.string (Json.array (Json.field params "paths"))
        val () = if List.length paths <= 128 then () else raise Workspace.Invalid "at most 128 folders can be watched"
        val show = Json.field params "showExcluded" = Json.Bool true
        fun add (path, acc) =
          if List.exists (fn (w : watched) => #path w = path) acc then acc else
          let val resolved = Workspace.resolve path
              val () = if resolved = path andalso OS.FileSys.isDir path then () else raise Workspace.Invalid "watch folders must be canonical directories"
          in {path = path, previous = ref ""} :: acc end
          handle OS.SysErr _ => acc
        val next = List.foldl add [] paths
    in watched := next; excluded := show; Json.Array (List.map (Json.String o #path) next) end
  fun changes () =
    let fun scan (w : watched) =
          let val rows = Workspace.listDirectory (#path w, !excluded)
              val encoded = Json.encode rows
          in if encoded = !(#previous w) then NONE else
               (#previous w := encoded; SOME (Json.Object [("path", Json.String (#path w)), ("entries", rows)])) end
          handle e =>
            let val message = (case e of Workspace.Invalid s => s | _ => General.exnMessage e)
                val encoded = "error:" ^ message
            in if encoded = !(#previous w) then NONE else
                 (#previous w := encoded; SOME (Json.Object [("path", Json.String (#path w)), ("entries", Json.Array []), ("error", Json.String message)])) end
    in Json.Object [("root", Json.String (Workspace.current ())), ("directories", Json.Array (List.mapPartial scan (!watched)))] end
end
