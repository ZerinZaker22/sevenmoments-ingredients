# the ingredient decoder: design system

## Brief
One-page lead-magnet tool for SEVEN MOMENTS (Whitney Sossou). Visitors type a product, paste a
list or upload a label photo and get a plain-English breakdown.

History: v1 warm pink. v2 (2026-11-22) a playful sticker sheet in bright pink #fc2e98 and blue
#0210f0. Whitney found v2 "a bit too playful": her inspo is "colorful but a bit on the classier
side". She sent a Canva mockup (powder blue collage, cream label boxes, Didone serif, rose script
"decoded", navy DECODE button with an olive circle) and said to explore its softer colors in
whatever combination looks best. v3 follows that mockup.

Stack: static page + Cloudflare Pages Function. Plain CSS, CSS keyframes only.

## Concept card
Idea:        a beauty editor's clipping: the label decoded on cream paper, pinned onto a collage of lace and halftone
Metaphor:    a vintage magazine collage / editor's moodboard
Signature:   the title as stacked paper labels with "decoded" written across them in rose script; results arrive as paper clippings, one after another
Emotion:     calm, considered, a little romantic. classy, still colorful
Motion verb: settle like paper (soft fade and a few pixels of rise, no bounce)
Screenshot:  powder-blue page, cream "The Ingredient / Decoder" labels, rose "decoded" script, lace and a torn halftone cloud

## Palette (from Whitney's inspo)
- powder  #b9cfdc  page ground
- cream   #f4efe2  paper boxes and cards
- navy    #0e1a38  ink, button, footer (10:1 on powder, 15:1 on cream)
- rose    #b5577c  the script accent only (decorative)
- olive   #8f8137  button circle; olive ink #6b5f22 for links and dashed borders on cream (5.2:1)
- muted   #3c4a66  small text (7.6:1 on cream, 5.2:1 on powder)

## Type
- Bodoni Moda (Google), weights 500 to 600, upright: title, headings, button, intro
- Hanken Grotesk (Google) 400 to 600: labels, hints, card body
- Allura (Google): the one script word, "decoded"
Small labels are tracked uppercase sans (0.28em) in thin boxes, as in the inspo.

## Shape and texture
Square corners. 1.5px navy hairlines. Soft paper shadow (4px 6px 14px navy at 20%).
Textures: lace net (navy, warped edges), a torn halftone cloud, fine paper grain on everything.
No tilts, no bounce, no badges, no ribbons.

## Motion
Ease cubic-bezier(.22,1,.36,1). Load: content fades up 10px, staggered 60ms. Results cards
fade up in sequence. Hover: button lifts 2px, its arrow slides 4px; dropzone border goes solid.
Idle: the cloud drifts a few pixels over 18s. All motion stops under reduced motion.
