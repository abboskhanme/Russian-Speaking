#!/usr/bin/env bash
# Builds the three user manuals from src/: one self-contained .html per role (CSS,
# the Onest font and every screenshot inlined, so the file can be sent as-is over
# Telegram) and an A4 .pdf of each, rendered by the same Playwright image the
# screenshot tooling uses.
#
#   bash docs/qollanma/build.sh
#
# Screenshots in src/img/ are crops of screenshots/govorim-2026-10-21/*/mobile/,
# cut so that no dev-only panel, localhost URL or real phone number shows.
set -euo pipefail
cd "$(dirname "$0")"
R="$(cd ../.. && pwd)"
FONT="$R/frontend/src/shared/styles/fonts/Onest-Variable.woff2"
PW_IMAGE="mcr.microsoft.com/playwright:v1.62.1-jammy"

ROLES=(admin:Admin oqituvchi:Oqituvchi oquvchi:Oquvchi)

inline() {  # $1 = src page, $2 = output file
  perl -MMIME::Base64 -e '
    sub slurp { local $/; open my $f, "<:raw", $_[0] or die "$_[0]: $!\n"; return <$f>; }
    my ($page, $font) = @ARGV;
    my $h = slurp("src/$page");
    $h =~ s/<!--\@include (\S+)-->/slurp("src\/$1")/ge;
    my $css = slurp("src/style.css");
    my $woff = encode_base64(slurp($font), "");
    $css =~ s{url\("fonts/Onest-Variable\.woff2"\)}{url("data:font/woff2;base64,$woff")};
    $h =~ s/<!--\@style-->/<style>\n$css<\/style>/;
    $h =~ s{src="img/([^"]+\.jpg)"}{"src=\"data:image/jpeg;base64," . encode_base64(slurp("src/img/$1"), "") . "\""}ge;
    die "unresolved include or style marker\n" if $h =~ /<!--\@/;
    die "image left uninlined\n" if $h =~ /src="img\//;
    print $h;
  ' "$1" "$FONT" > "$2"
}

HTML=()
for pair in "${ROLES[@]}"; do
  src="${pair%%:*}"; name="${pair#*:}"
  out="Govorim-qollanma-${name}.html"
  inline "${src}.html" "$out"
  HTML+=("$out")
  echo "html  $out  $(du -h "$out" | cut -f1)"
done

docker run --rm --ipc=host -v "$PWD":/d -v "$R/frontend":/w:ro -w /d "$PW_IMAGE" \
  node /d/render-pdf.mjs "${HTML[@]}"
