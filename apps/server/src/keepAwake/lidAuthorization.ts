const lidAuthorizationPath = "/etc/sudoers.d/t3code-keep-awake";

export function lidSudoers(username: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(username)) throw new Error("Unsupported macOS username");
  return `Cmnd_Alias T3CODE_KEEP_AWAKE = /usr/bin/pmset -a disablesleep 1, /usr/bin/pmset -a disablesleep 0\n${username} ALL=(root) NOPASSWD: T3CODE_KEEP_AWAKE\n`;
}

export const shellQuote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

export function lidAuthorizationScript(username: string, remove: boolean) {
  if (remove) return `/bin/rm -f ${lidAuthorizationPath}`;
  return `set -eu\n/bin/mkdir -p /etc/sudoers.d\ntmp=$(/usr/bin/mktemp /etc/sudoers.d/.t3code-keep-awake.XXXXXX)\ntrap '/bin/rm -f "$tmp"' EXIT\n/usr/bin/printf %s ${shellQuote(lidSudoers(username))} > "$tmp"\n/usr/sbin/visudo -cf "$tmp"\n/usr/sbin/chown root:wheel "$tmp"\n/bin/chmod 0440 "$tmp"\n/bin/mv -f "$tmp" ${lidAuthorizationPath}`;
}
