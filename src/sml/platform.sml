(* The host supplies its platform once, before persistence or file operations. *)
structure Platform =
struct
  val windows = ref false
  fun initialize params = windows := Json.field params "platform" = Json.String "win32"
  fun vmName () = if !windows then "bin/runevm.exe" else "bin/runevm"
end
