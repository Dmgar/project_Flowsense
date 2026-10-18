# FlowSense brand assets

The FlowSense logo was supplied for this project. The PNG is retained without
pixel changes. The SVG display frame embeds those same bytes and frames the mark;
it does not redraw or approximate its geometry.

## Assets and usage

- `frontend/public/flowsense-logo.png`: original supplied artwork.
- `frontend/public/flowsense-logo.svg`: display frame for the original artwork.
- `frontend/public/favicon.svg`: the same mark for browser tabs.
- `frontend/src/components/BrandMark.tsx`: shared accessible image component.
- `src/assets/flowsense-logo.png`: identical original artwork bundled with the
  backend for downloadable PDF reports, including the backend Docker image.

The mark appears in desktop navigation, the persistent mobile header, loading and
error views, the classic frontend entry components, the playback verification
page, printed reports and downloadable PDFs. The white dark-mode rendition is a
CSS presentation effect; the source file is unchanged. Public camera images are
not recolored.

## Color roles

| Role | Light appearance | Dark appearance |
| --- | --- | --- |
| Workspace | `#F5F6F8` | `#111216` |
| Main surface | `#FFFFFF` | `#1A1C22` |
| Main text and primary actions | `#17191E` | `#F3F4F7` |
| Selection and links | `#245DDA` | `#9BBAFF` |

Decorative sage surfaces use neutral graphite shades. Green, amber and red remain
reserved for availability, caution, risk and traffic semantics. Selection also
uses borders, active indicators and accessible pressed/checked states.

Theme, semantic colors and geometry must remain independent: do not replace
traffic or risk colors with a brand color or distort the logo to fill its box.
