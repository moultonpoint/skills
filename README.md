<p align="center">
  <a href="https://linktr.ee/moultonpoint"><img src="./.claude-plugin/icon.png" alt="moultonpoint" width="120"></a>
</p>

<h1 align="center">moultonpoint skills</h1>

<p align="center"><b>Useful things. Built and tested.</b></p>

<p align="center">
  <a href="https://www.tiktok.com/@moultonpoint">TikTok</a> ·
  <a href="https://www.youtube.com/@moultonpoint">YouTube</a> ·
  <a href="https://www.instagram.com/moultonpoint_/">Instagram</a> ·
  <a href="https://x.com/moultonpoint">X</a> ·
  <a href="https://linktr.ee/moultonpoint">Everything else</a>
</p>

Agent skills I use to build things and research videos. Give [analyze](./skills/content/analyze/SKILL.md) TikTok, Instagram Reels or YouTube Shorts links and it puts the frames, captions and cuts side by side in an HTML report.

## Why I made these

I wanted to know how a short video opens, where it cuts and whether it got more views than the creator usually gets. Some paid tools sell that breakdown. My agent can do it locally with yt-dlp and ffmpeg.

## First run

After installation, start a session with your agent in the folder where you want the report. Replace the placeholder with a public video link:

> Use analyze on PASTE-A-PUBLIC-VIDEO-LINK. Show me the opening hook and how the shots change.

Expect `./analyze/<YYYY-MM-DD>-<short-slug>/report.html`. Open it offline or share the HTML file. It includes the source links, frames and captions. The skill is free, MIT licensed and requires no account. Instagram may require permission to use your signed-in browser session.

## Installation

Your agent needs terminal, network and image-reading access. Install Node.js 20+, yt-dlp, ffmpeg and ffprobe (included with ffmpeg). For YouTube use Node 22+ or Deno 2.3+. YouTube also needs the EJS solver. Official yt-dlp binaries bundle it. For other builds the fetcher enables GitHub solver downloads when needed. [yt-dlp setup guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS)

```sh
# macOS
brew install node yt-dlp ffmpeg
```

```powershell
# Windows
winget install --id OpenJS.NodeJS -e
winget install --id yt-dlp.yt-dlp -e
winget install --id Gyan.FFmpeg -e
```

The plugin commands use the GitHub marketplace. You can also install from a local copy using the commands for your agent below. Run local copy commands from the repository root.

<details>
<summary>Claude Code</summary>

Inside Claude Code:

```text
/plugin marketplace add moultonpoint/skills
/plugin install moultonpoint-skills@moultonpoint
```

Local installation on macOS or Linux:

```sh
mkdir -p "$HOME/.claude/skills"
cp -R "skills/content/analyze" "$HOME/.claude/skills/"
```

Local installation in PowerShell:

```powershell
New-Item -ItemType Directory -Force "$HOME/.claude/skills"
Copy-Item -Recurse -Force "skills/content/analyze" "$HOME/.claude/skills/"
```

To update, run `claude plugin marketplace update moultonpoint` and `claude plugin update moultonpoint-skills@moultonpoint` in your terminal, then restart Claude Code. For a local installation, copy the updated skill again.

</details>

<details>
<summary>Codex</summary>

In your terminal:

```sh
codex plugin marketplace add moultonpoint/skills
codex plugin add moultonpoint-skills@moultonpoint
```

Local installation on macOS or Linux:

```sh
mkdir -p "$HOME/.agents/skills"
cp -R "skills/content/analyze" "$HOME/.agents/skills/"
```

Local installation in PowerShell:

```powershell
New-Item -ItemType Directory -Force "$HOME/.agents/skills"
Copy-Item -Recurse -Force "skills/content/analyze" "$HOME/.agents/skills/"
```

To update, run `codex plugin marketplace upgrade moultonpoint` and repeat the plugin add command. For a local installation, copy the updated skill again.

</details>

<details>
<summary>Other agents via skills.sh (untested)</summary>

```sh
npx skills@latest add moultonpoint/skills
```

Select `analyze` and your agent when prompted. To update, run `npx skills@latest update`.

</details>

**Disclosure**: I made these. I don't sell anything. No affiliate links.

---

Built by [moultonpoint](https://github.com/moultonpoint). I document what I build with AI agents on [TikTok](https://www.tiktok.com/@moultonpoint) and [YouTube](https://www.youtube.com/@moultonpoint). MIT licensed: use it, change it, ship it.
