# FlowSense brand assets

The supplied `brandbook.html` and `README.md` are the design references for the
FlowSense identity. Keep the supplied logo geometry intact, preserve its clear
space, and use a mark whose color contrasts with its background. The approved
working color signatures are black `#111316`, white `#FFFFFF`, and petrol
`#00707A`. The identity uses Segoe UI with a system fallback; no font files are
bundled.

## Supplied logo files

The twelve PNGs in `frontend/public/brand/` are exact byte-for-byte copies of the
same-named files supplied with the project. SHA-256 checksums were compared
against those source files; the repository checksums below identify the audited
copies:

| Asset | SHA-256 |
| --- | --- |
| `imagotipo-horizontal-black.png` | `e0111cf8449bf07b98ba4c501aa4c2c7628a23ba5cdd9ca34bbbbc9b017e2d77` |
| `imagotipo-horizontal-petrol.png` | `caef099610167dc02e008ccf0677060f63a54221705cd30a187e3725fedff3a0` |
| `imagotipo-horizontal-white.png` | `0b9934389cbdec9b38e265416e83df4a87cdb5f18c38155c6e72abad63e800f3` |
| `imagotipo-vertical-black.png` | `3475adaa4ce82417c429566699647790b8155bf61fa3861dea4eee9a5c231382` |
| `imagotipo-vertical-petrol.png` | `bff74c2da8dee5355410b7e9b9638c18897cab67258020efaacad72b78be6de5` |
| `imagotipo-vertical-white.png` | `869bb9f2d6a7fe70e21f9a6a667431bf52a5585756b2a1a08464c9acf09afdf5` |
| `isotipo-black.png` | `9960bec5232f21b119ce78184e052c198e9d2ca02e14124747bee39302d49b0c` |
| `isotipo-petrol.png` | `6c5d10b9c17b41a48b05322cfe94b07d8047d27b2d32527277c097f21811eec5` |
| `isotipo-white.png` | `bb1d097873407da1aca3b13ca9f6492ff281c38d6b842e3619aee21a07b72068` |
| `logotipo-black.png` | `f77f9ad6fb62230e36699694173fae72df1b8cdf1aef96bdd49b5adeed88861f` |
| `logotipo-petrol.png` | `c8dfe496ae22851d4607055aad1c54f919f7aff846201f2dec655b533708e5dc` |
| `logotipo-white.png` | `9f8f274b65eaadd0098c11e27d56bc005c29f58d51060cb80d6ad4f2a955e083` |

`frontend/src/components/BrandMark.tsx` displays the isotipo and logotipo
variants for light, dark, and print contexts. The mobile header retains the
isotipo at narrow widths. App and playback-QA favicons use the petrol isotipo
for light browser themes and the white isotipo for dark browser themes. The
horizontal and vertical imagotipos remain available in the public asset folder
for approved layouts.

Do not place white artwork on a light background or black artwork on a dark
background. Do not stretch, rotate, outline, recolor, or redraw the supplied
logo. Keep meaningful image text accessible through its containing control or
image label; decorative marks stay hidden from assistive technology.

## Rights and scope

The hash comparison confirms that the repository copies match the files the
requester supplied. It does not establish who owns the copyright or trademark,
or grant permission for public or commercial use. No assignment, license, or
creator authorization was included with the files. Obtain and retain that
written evidence before external publication.

No bundled stock photography or third-party illustration is used in the
product interface. Map tiles and camera media load from external providers and
have separate terms, attribution, retention, and commercial-use requirements;
see [the legal implementation review](legal/IMPLEMENTATION_REVIEW.md). Do not
interpret publicly reachable URLs as proof of reuse rights.
