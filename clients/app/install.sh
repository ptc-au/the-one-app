#!/bin/sh
# Installs a network's app on Linux for whoever runs it, as `tooling/installers` packs it with makeself, which runs this
# in the folder it unpacked: `sh ptc-linux.run`. Its program, named its network's command, and its `network` go in
# ~/.local/lib/<its identifier>, and `<command>` and `git-remote-<command>` in ~/.local/bin are links to it, as a
# person's own programs are (systemd's file-hierarchy). Its `network` names it as it runs (`bundle` in core/client), so
# its client is its own, in ~/.local/share/<its identifier>, beside another network's. Its updates replace the program
# alone, in place. Run again, it puts the program there anew; what's in ~/.local/bin that isn't a link stays.
set -eu
command=$1 identifier=$2
lib=$HOME/.local/lib/$identifier bin=$HOME/.local/bin
mkdir -p "$lib" "$bin"
cp network "$lib/network"
# Moved into place in one step, as a server may be running the one there.
cp "$command" "$lib/.$command.new" && chmod 755 "$lib/.$command.new" && mv -f "$lib/.$command.new" "$lib/$command"
for name in "$command" "git-remote-$command"; do
  if [ -e "$bin/$name" ] && [ ! -L "$bin/$name" ]; then
    echo "$bin/$name is another program, so it stays as it is." >&2
    continue
  fi
  ln -sfn "$lib/$command" "$bin/$name"
done
echo "Installed $("$lib/$command" --version)."
case ":$PATH:" in
*":$bin:"*) echo "\`$command sign-in check\` signs this computer in." ;;
*) echo "Add $bin to your PATH, then \`$command sign-in check\` signs this computer in." ;;
esac
