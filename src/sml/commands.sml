(* Shared command metadata, availability and search policy. UI adapters dispatch IDs. *)
structure Commands =
struct
  datatype requirement = Always | Ready | Workspace | Editor | Writable | Documents | Building | IdleWorkspace
  val definitions =
    [("palette", "Command Palette", "View", "CmdOrCtrl+Shift+P", Always),
     ("open-folder", "Open Folder", "File", "CmdOrCtrl+O", Ready),
     ("save", "Save", "File", "CmdOrCtrl+S", Writable),
     ("save-all", "Save All", "File", "CmdOrCtrl+Shift+S", Documents),
     ("close", "Close Editor", "File", "CmdOrCtrl+W", Editor),
     ("close-all", "Close All Editors", "File", "", Documents),
     ("build", "Save and Build", "Build", "CmdOrCtrl+Shift+B", IdleWorkspace),
     ("cancel-build", "Cancel Build", "Build", "", Building),
     ("split", "Split Editor", "View", "CmdOrCtrl+\\", Editor),
     ("reveal", "Reveal Active File", "View", "", Editor),
     ("focus-explorer", "Focus Explorer", "View", "CmdOrCtrl+Shift+E", Workspace),
     ("focus-editor", "Focus Editor", "View", "CmdOrCtrl+1", Editor),
     ("focus-output", "Focus Output", "View", "CmdOrCtrl+Shift+U", Always),
     ("focus-problems", "Focus Problems", "View", "CmdOrCtrl+Shift+M", Always),
     ("zoom-in", "Zoom In", "View", "CmdOrCtrl+=", Always),
     ("zoom-out", "Zoom Out", "View", "CmdOrCtrl+-", Always),
     ("zoom-reset", "Reset Zoom", "View", "CmdOrCtrl+0", Always),
     ("theme-dark", "Color Theme: Dark", "View", "", Always),
     ("theme-light", "Color Theme: Light", "View", "", Always),
     ("theme-contrast", "Color Theme: High Contrast", "View", "", Always)]
  fun list params =
    let val context = Json.field params "context"
        fun flag name = Json.field context name = Json.Bool true
        val ready = flag "ready"
        val idle = ready andalso not (flag "busy")
        fun enabled Always = true
          | enabled Ready = idle
          | enabled Workspace = ready andalso flag "workspace"
          | enabled Editor = ready andalso flag "editor"
          | enabled Writable = ready andalso flag "editor" andalso not (flag "readOnly")
          | enabled Documents = ready andalso flag "documents"
          | enabled Building = flag "building"
          | enabled IdleWorkspace = idle andalso flag "workspace"
        fun lower s = String.map Char.toLower s
        val query = case Json.field params "query" of Json.String s => s | _ => ""
        val () = if String.size query <= 256 then () else raise Json.Invalid "command query exceeds 256 bytes"
        val words = String.tokens Char.isSpace (lower query)
        fun matches (id, label, category, _, _) =
          List.all (fn word => String.isSubstring word (lower (category ^ " " ^ label ^ " " ^ id))) words
        fun row (id, label, category, shortcut, requirement) = Json.Object [
          ("id", Json.String id), ("label", Json.String label), ("category", Json.String category),
          ("shortcut", Json.String shortcut), ("enabled", Json.Bool (enabled requirement))]
    in Json.Array (List.map row (List.filter matches definitions)) end
end
