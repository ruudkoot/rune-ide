(* A small strict JSON codec, shared by service and compiler adapters. *)
structure Json =
struct
  datatype value = Null | Bool of bool | Number of string | String of string
                 | Array of value list | Object of (string * value) list
  exception Invalid of string
  fun int n = Number (String.translate (fn #"~" => "-" | c => String.str c) (Int.toString n))
  fun quote s =
    let
      val () = Utf8.validate s
      val hex = "0123456789abcdef"
      fun escape c =
        case c of #"\"" => "\\\"" | #"\\" => "\\\\" | #"\n" => "\\n" | #"\r" => "\\r" | #"\t" => "\\t"
        | _ => if Char.ord c < 32 then "\\u00" ^ String.str (String.sub (hex, Char.ord c div 16)) ^ String.str (String.sub (hex, Char.ord c mod 16)) else String.str c
    in "\"" ^ String.translate escape s ^ "\"" end
  fun encode Null = "null"
    | encode (Bool b) = if b then "true" else "false"
    | encode (Number n) = n
    | encode (String s) = quote s
    | encode (Array xs) = "[" ^ String.concatWith "," (List.map encode xs) ^ "]"
    | encode (Object xs) = "{" ^ String.concatWith "," (List.map (fn (k, v) => quote k ^ ":" ^ encode v) xs) ^ "}"
  fun field (Object xs) key = (case List.find (fn (k, _) => k = key) xs of SOME (_, v) => v | NONE => Null)
    | field _ _ = Null
  fun string (String s) = s | string _ = raise Invalid "expected string"
  fun integer (Number s) = (case Int.fromString s of SOME n => if encode (int n) = s then n else raise Invalid "expected integer" | NONE => raise Invalid "integer out of range")
    | integer _ = raise Invalid "expected integer"
  fun array (Array xs) = xs | array _ = raise Invalid "expected array"
  fun getString v k = string (field v k)
  fun getInt v k = integer (field v k)
  fun parse text =
    let
      val () = Utf8.validate text
      val len = String.size text
      val pos = ref 0
      fun fail () = raise Invalid ("invalid JSON at byte " ^ Int.toString (!pos))
      fun peek () = if !pos < len then String.sub (text, !pos) else #"\000"
      fun take () = if !pos < len then let val c = peek () in pos := !pos + 1; c end else fail ()
      fun expect c = if take () = c then () else fail ()
      fun ws () = if List.exists (fn c => c = peek ()) [#" ", #"\t", #"\r", #"\n"] then (pos := !pos + 1; ws ()) else ()
      fun four () =
        let fun digit c = if c >= #"0" andalso c <= #"9" then Char.ord c - 48
                         else if c >= #"a" andalso c <= #"f" then Char.ord c - 87
                         else if c >= #"A" andalso c <= #"F" then Char.ord c - 55 else fail ()
            fun go (0, n) = n | go (k, n) = go (k - 1, n * 16 + digit (take ()))
        in go (4, 0) end
      fun str () =
        let
          val () = expect #"\""
          fun go acc =
            case take () of
              #"\"" => String.concat (List.rev acc)
            | #"\\" =>
                let val s = case take () of
                      #"\"" => "\"" | #"\\" => "\\" | #"/" => "/" | #"b" => "\b" | #"f" => "\f"
                    | #"n" => "\n" | #"r" => "\r" | #"t" => "\t"
                    | #"u" => let val n = four ()
                              in if n >= 55296 andalso n <= 56319 then
                                   (expect #"\\"; expect #"u";
                                    let val m = four () in if m < 56320 orelse m > 57343 then fail () else Utf8.encode (65536 + (n - 55296) * 1024 + m - 56320) end)
                                 else Utf8.encode n end
                    | _ => fail ()
                in go (s :: acc) end
            | c => if Char.ord c < 32 then fail () else go (String.str c :: acc)
        in go [] end
      fun literal s v = (List.app expect (String.explode s); v)
      fun number () =
        let
          val start = !pos
          fun digits () = if Char.isDigit (peek ()) then (pos := !pos + 1; digits ()) else ()
          fun someDigits () = if Char.isDigit (peek ()) then digits () else fail ()
          val () = if peek () = #"-" then pos := !pos + 1 else ()
          val () = if peek () = #"0" then pos := !pos + 1 else someDigits ()
          val () = if peek () = #"." then (pos := !pos + 1; someDigits ()) else ()
          val () = if peek () = #"e" orelse peek () = #"E" then
                     (pos := !pos + 1; if peek () = #"+" orelse peek () = #"-" then pos := !pos + 1 else (); someDigits ()) else ()
        in Number (String.substring (text, start, !pos - start)) end
      fun value depth =
        if depth > 128 then raise Invalid "JSON nesting limit" else
        (ws (); case peek () of
           #"\"" => String (str ())
         | #"n" => literal "null" Null | #"t" => literal "true" (Bool true) | #"f" => literal "false" (Bool false)
         | #"[" =>
             let
               val () = expect #"["
               fun items acc = let val v = value (depth + 1) val () = ws ()
                               in case take () of #"]" => Array (List.rev (v :: acc)) | #"," => items (v :: acc) | _ => fail () end
             in ws (); if peek () = #"]" then (pos := !pos + 1; Array []) else items [] end
         | #"{" =>
             let
               val () = expect #"{"
               fun items acc =
                 let val () = ws () val k = str () val () = ws () val () = expect #":"
                     val v = value (depth + 1) val () = ws ()
                     val () = if List.exists (fn (key, _) => key = k) acc then raise Invalid "duplicate JSON key" else ()
                 in case take () of #"}" => Object (List.rev ((k, v) :: acc)) | #"," => items ((k, v) :: acc) | _ => fail () end
             in ws (); if peek () = #"}" then (pos := !pos + 1; Object []) else items [] end
         | c => if c = #"-" orelse Char.isDigit c then number () else fail ())
      val v = value 0
      val () = ws ()
    in if !pos = len then v else fail () end
end
