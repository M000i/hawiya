# Elements for each platform (Steps 1 and 3)

Hawiya version 1 supports one platform: `web` (sites, landing pages, web apps, dashboards, standalone HTML).
Every element in the page suits the web, so a web project gets all eleven.

| Element | Session name | Web |
|---|---|---|
| Colors | `colors` | yes |
| Light and dark modes | `modes` | yes |
| Fonts | `fonts` | yes |
| Type scale | `type-scale` | yes |
| Corners | `radius` | yes |
| Shadows | `shadows` | yes |
| Icons | `icons` | yes |
| Buttons | `buttons` | yes |
| Cards | `cards` | yes |
| Spacing | `spacing` | yes |
| Direction (RTL, LTR or both) | `direction` | yes |

In the session file write `"platform": "web"` and `"elements"` with all eleven names, in this order.

Native mobile (iOS, Android) and desktop apps are not supported yet: tell the user, and if they still want an
identity, treat the project as web with the closest web type. Do not drop or add element names: only the
eleven above are valid, and the page refuses a session file with any other value.
