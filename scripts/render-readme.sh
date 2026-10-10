#!/bin/sh
# Render the README's farm-themed images with headless Chrome: the section signs and the four steps
# (scripts/readme/*.html, in the site's fonts and colors) into assets/readme/. A sign's text can end in |ICON, a
# picture next to sign.html, instead of the logo. Needs Python with Pillow (to crop).
set -e
cd "$(dirname "$0")/.."
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
shot() { # shot OUT URL WIDTH HEIGHT
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --default-background-color=00000000 \
    --allow-file-access-from-files --window-size="$3,$4" --virtual-time-budget=1500 --screenshot="$PWD/$1" "$2" 2>/dev/null
  python3 -c "import sys; from PIL import Image; p = sys.argv[1]; im = Image.open(p); im.crop(im.getbbox()).save(p, optimize=True)" "$1"
}
while IFS='|' read -r slug text; do
  shot "assets/readme/$slug.png" "file://$PWD/scripts/readme/sign.html#$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$text")" 1100 110
done <<'SIGNS'
make-money|MAKE MONEY|apps.svg
why|WHY CLODFARM
quick-start|QUICK START
connect|CONNECT CLAUDE CODE
deploy|DEPLOY
how-it-works|HOW IT WORKS
how-it-compares|HOW IT COMPARES
logging-in|LOGGING IN
commands|COMMANDS
faq|FAQ
related|RELATED PROJECTS
contributing|CONTRIBUTING
license|LICENSE
SIGNS
shot assets/readme/steps.png "file://$PWD/scripts/readme/steps.html" 1100 300
echo "assets/readme/"
