(* UTF-8 at the service boundary; offsets in browser strings count UTF-16 units. *)
structure Utf8 =
struct
  exception Invalid of string
  fun encode n =
    let fun c n = Char.chr n
    in
      if n < 0 orelse n > 1114111 orelse (n >= 55296 andalso n <= 57343)
      then raise Invalid "invalid Unicode scalar"
      else if n < 128 then String.str (c n)
      else if n < 2048 then String.implode [c (192 + n div 64), c (128 + n mod 64)]
      else if n < 65536 then String.implode [c (224 + n div 4096), c (128 + n div 64 mod 64), c (128 + n mod 64)]
      else String.implode [c (240 + n div 262144), c (128 + n div 4096 mod 64), c (128 + n div 64 mod 64), c (128 + n mod 64)]
    end
  fun next (s, i) =
    let
      fun byte k = if k < String.size s then Char.ord (String.sub (s, k)) else raise Invalid "truncated UTF-8"
      val a = byte i
      fun continuation k = let val b = byte k in if b >= 128 andalso b < 192 then b - 128 else raise Invalid "invalid UTF-8 continuation" end
      val (n, len) =
        if a < 128 then (a, 1)
        else if a >= 194 andalso a < 224 then ((a - 192) * 64 + continuation (i + 1), 2)
        else if a >= 224 andalso a < 240 then ((a - 224) * 4096 + continuation (i + 1) * 64 + continuation (i + 2), 3)
        else if a >= 240 andalso a < 245 then ((a - 240) * 262144 + continuation (i + 1) * 4096 + continuation (i + 2) * 64 + continuation (i + 3), 4)
        else raise Invalid "invalid UTF-8 lead byte"
      val () = if (len = 3 andalso n < 2048) orelse (len = 4 andalso n < 65536)
                   orelse n > 1114111 orelse (n >= 55296 andalso n <= 57343)
               then raise Invalid "invalid UTF-8 scalar" else ()
    in (n, i + len) end
  fun validate s =
    let fun go i = if i >= String.size s then () else go (#2 (next (s, i)))
    in go 0 end
  fun byteOffset (s, units) =
    let fun go (i, u) =
      if u = units then i
      else if u > units orelse i >= String.size s then raise Invalid "invalid UTF-16 offset"
      else let val (n, j) = next (s, i) in go (j, u + (if n > 65535 then 2 else 1)) end
    in if units < 0 then raise Invalid "negative offset" else go (0, 0) end
end
