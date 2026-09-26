structure IdeCompilerMain =
struct
  fun main () = case CommandLine.arguments () of
    report :: args =>
      let val result = Main.main (CommandLine.name (), args)
                        handle e => (TextIO.output (TextIO.stdErr, General.exnMessage e ^ "\n"); OS.Process.failure)
          val () = CompilerDiagnostics.write (report, OS.Process.isSuccess result)
      in OS.Process.exit result end
  | [] => (TextIO.output (TextIO.stdErr, "rune-ide compiler: expected a report path\n"); OS.Process.exit OS.Process.failure)
  val _ = main ()
end
