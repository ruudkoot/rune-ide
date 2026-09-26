(* Inserted after Rune's Error module, without altering the Rune checkout.
   Capture errors when the driver formats the final exception: parser errors
   used for speculative parsing must not become IDE diagnostics. *)
structure CompilerDiagnostics =
struct
  val items : (string * Source.span * string) list ref = ref []
  fun add (severity, span, message) = items := (severity, span, message) :: !items
  fun point (text, offset) =
    let val stop = Int.min (String.size text, Int.max (0, offset))
        val first = if String.isPrefix "\239\187\191" text then 3 else 0
        fun go (i, line, column) =
          if i >= stop then (line, column)
          else let val (scalar, next) = Utf8.next (text, i)
               in if scalar = 10 then go (next, line + 1, 1)
                  else go (next, line, column + (if scalar > 65535 then 2 else 1)) end
    in go (first, 1, 1) end
  fun range (span : Source.span) =
    case Source.findFile (#file span) of NONE => Json.Null
    | SOME source =>
      let val (sl, sc) = point (#text source, #start span)
          val (el, ec) = point (#text source, #stop span)
      in Json.Object [("startLineNumber", Json.int sl), ("startColumn", Json.int sc),
                      ("endLineNumber", Json.int el), ("endColumn", Json.int ec)] end
      handle Utf8.Invalid _ => Json.Null
  fun item (severity, span : Source.span, message) = Json.Object [
    ("severity", Json.String severity), ("message", Json.String message),
    ("path", Json.String (#file span)), ("startByte", Json.int (#start span)),
    ("endByte", Json.int (#stop span)), ("range", range span)]
  fun write (path, success) =
    let val report = Json.Object [("version", Json.int 1), ("success", Json.Bool success),
          ("compilerVersion", Json.String Config.version),
          ("diagnostics", Json.Array (List.map item (List.rev (!items))))]
        val stream = TextIO.openOut path
    in (TextIO.output (stream, Json.encode report ^ "\n"); TextIO.closeOut stream)
       handle e => (TextIO.closeOut stream; raise e) end
end
structure OriginalError = Error
structure Error =
struct
  open OriginalError
  fun format (span, message) = (CompilerDiagnostics.add ("error", span, message); OriginalError.format (span, message))
  fun warn (span, message) = (CompilerDiagnostics.add ("warning", span, message); OriginalError.warn (span, message))
end
