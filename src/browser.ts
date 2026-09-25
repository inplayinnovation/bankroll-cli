// Opening a page in the person's default browser, with the platform's own
// opener. Best effort: the link is always printed too, for a shell without a
// browser behind it, such as a coding agent's.
import { spawn } from 'node:child_process';

export function browserCommand(platform: NodeJS.Platform = process.platform): [string, string[]] {
  switch (platform) {
    case 'darwin':
      return ['open', []];
    case 'win32':
      return ['cmd', ['/c', 'start', '']];
    default:
      return ['xdg-open', []];
  }
}

export function openBrowser(url: string): void {
  const [command, args] = browserCommand();
  const child = spawn(command, [...args, url], { detached: true, stdio: 'ignore' });
  // A missing opener is not a failure: the link is on screen.
  child.on('error', () => {});
  child.unref();
}
