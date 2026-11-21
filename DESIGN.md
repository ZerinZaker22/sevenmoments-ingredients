# the ingredient decoder: design system

## Brief
One-page lead-magnet tool for SEVEN MOMENTS (Whitney Sossou). Visitors type a product, paste a
list or upload a label photo and get a plain-English breakdown. Client asks: her bright pink and
blue with white, a bright pink or blue background, bold non-italic type, icons here and there, a
pattern, fun. Zerin's references: Brushi (sticker badge, scalloped edge, crossed ribbons, squiggle,
doodle pattern, pill button with icon circle) and Ghia (wavy edges, circular text, tilted highlight
boxes, tilted sticker cards with icon stickers, huge footer wordmark).
Stack: the existing static page + Cloudflare Pages Function. Plain CSS, CSS keyframes only (no
GSAP/Lenis): it is a single tool screen with nothing scroll-driven, so a motion library would be
weight without a job.

## Concept card
Idea:        you hand it a label, it hands you back labels. every ingredient group returns as a sticker for your shelf.
Metaphor:    a sticker sheet / packaging label sheet
Signature:   results "slap" onto the page one sticker at a time, each with its own icon sticker peeking off the corner
Emotion:     loud, happy, honest. a beauty counter with the lights on
Motion verb: peel and press, like a sticker (lift on hover, press into the shadow on click, settle with a small overshoot)
Screenshot:  pink hero, huge white "ingredient", the blue tilted "decoder" box, the spinning badge biting the corner of the tool card

## Palette (client colors only)
- pink   #fc2e98  hero ground, stickers, ribbon 2, focus ring
- blue   #0210f0  ink on white (9:1), tool-card shadow, decoder box, ribbon 1, footer
- white  #ffffff  cards, page ground
- tints of those three only (pink 8% wash in the dropzone, blue 78% for small muted text, 6.4:1)
Contrast rules: white on pink is 3.5:1, so only large bold text (19px/700 and up) sits on pink.
Blue on pink fails, so blue never carries text on pink. Small text always sits on white or blue.

## Type
Bricolage Grotesque (Google, variable opsz 12..96, wght 400..800). Display 800, tracking -0.04em,
leading 0.88. UI and body 400/600 at 16-18px, leading 1.5. One family, roles by weight and opsz.

## Shape
Pills (999px) for buttons and chips, 28px for cards, 18px for inputs. Hard offset shadows only
(blue under white, pink under blue): stickers, not floating glass.

## Sections
1. Hero (pink, doodle pattern, scalloped bottom): headline left, tool card right (stacked on phone)
2. Ribbons: two crossed marquee bands, blue and pink
3. Results (white, appears after a decode): heading + count sticker, intro, sticker columns, worth knowing, fine print
4. Footer (blue, wavy top edge, huge "seven moments" wordmark)

## Motion
Ease cubic-bezier(.2,.9,.25,1.2) for sticker settles, cubic-bezier(.22,1,.36,1) for everything else.
Idle: badge rotates (24s), ribbons scroll, footer sparkle turns. All of it stops under reduced motion.
