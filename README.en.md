# Kod Akışı (Code Stream)

A Claude Code plugin that shows the code Claude is writing, live, in a side pane. · [Türkçe](README.md)

![Kod Akışı pane: a stream-rate graph, the thinking text as it flows, code written line by line and an activity log](assets/onizleme.svg)

<sub>The preview is an illustration; the pane is drawn with Claude Code's own font and color theme.</sub>

While Claude writes a file you usually see a spinner and collapsed rows. Kod Akışı streams the code into a pane beside the conversation as the model produces it: files with line numbers and syntax colors, edits as a live diff, commands with the tail of their output. When thinking text is being sent, it streams in a box of its own; when subagents are at work, each one gets its own row.

It asks the model for nothing extra. It draws the response stream that is already arriving, so it costs no additional tokens.

## Install

A current Claude Code is enough (tested on 2.1.286). Pick one of the two ways, then restart Claude or open a new session.

### One command

macOS and Linux:

```bash
git clone https://github.com/Ilyas-jpg/kod-akisi ~/.claude/skills/kod-akisi
```

Windows (PowerShell):

```powershell
git clone https://github.com/Ilyas-jpg/kod-akisi "$HOME\.claude\skills\kod-akisi"
```

Without git (macOS and Linux):

```bash
mkdir -p ~/.claude/skills/kod-akisi && curl -fsSL https://github.com/Ilyas-jpg/kod-akisi/archive/refs/heads/main.tar.gz | tar -xz --strip-components=1 -C ~/.claude/skills/kod-akisi
```

### Plugin manager

```bash
claude plugin marketplace add https://github.com/Ilyas-jpg/kod-akisi
claude plugin install kod-akisi@ilyassaltay
```

Use only one of the two. If both are installed, Claude Code loads the first plugin of that name.

## Use

The pane opens by itself in a new session. `/kod-akisi` opens it, `/kod-akisi kapat` closes it and stops it from opening automatically.

## What is in the pane

- **Stage.** The file being written streams with line numbers and syntax colors, following the last lines with a cursor at the tip. Edits arrive as a live diff and become the real numbered patch once the tool finishes. Commands show the tail of their output underneath.
- **Header.** What Claude is doing right now, how many subagents are running, tool count, output tokens and elapsed time. Under it, a graph of the stream rate: bars are born on the right and fade as they walk left.
- **Thought.** The model's thinking text streams in a violet box that follows its last lines. While a tool runs, the last thought stays readable, dimmed.
- **Agents.** One row per running subagent: its type, what it is doing, tool count and time.
- **Ticker.** The live tip of the narration text.
- **Log.** Recent tool calls, newest first. A subagent's calls are marked with that agent's color.

## Seeing the thinking

Claude Code sends thinking text only when asked to. Otherwise the model still thinks, but the text is not in the stream and the pane has nothing to draw.

- **Desktop app:** in the conversation's title menu choose Transcript view › Thinking (or Verbose). The default view for new sessions is in Settings.
- **Terminal:** add `"showThinkingSummaries": true` to `~/.claude/settings.json`.

What arrives is the thinking summary Claude Code provides, not the model's raw inner monologue. When thinking is happening unseen, the pane shows a dim note on how to turn it on for the first few turns, then stays quiet.

## Subagents

When Claude hands work to subagents, each one gets a row in the pane. The stage shows whichever loop is writing code at the moment and puts the agent's name in its header. The main conversation always has priority; parallel agents do not cut into each other's stream, the stage moves on once a stream settles.

An agent running in the background stays visible after the main conversation finishes, and the header says how many are still working. In the terminal, opening an agent's transcript from the task list makes the pane draw that agent alone.

The engine's own internal loops (compaction, memory and the like) are not agents and never show up in the pane.

## How it works

Kod Akışı runs on Claude Code's mod system (function hooks). It listens to the model's response stream on `turn.step`, decodes tool arguments from their partial JSON and draws the pane. It never changes the stream or a tool result; every chunk passes through as it came.

It makes no network, file system or process calls. Everything it asks of the engine: opening and closing its pane, keeping its own state and two small preferences, timers, registering its command, a toast, reading the list of subagents and one line in the debug log. `claude plugin validate .claude-plugin/plugin.json` reads that list off the source.

## Limits

- The mod system is early access and may change with a Claude Code update. If it does, the pane does not appear; the session itself is unaffected.
- The interface is in Turkish.
- Used on the Windows desktop app and exercised on the terminal surface through Claude Code's test kit. Nothing in the code is specific to an operating system, so it is expected to work on macOS and Linux; it has not been tried there yet.

## Develop

```bash
claude plugin validate .claude-plugin/plugin.json
claude plugin test .
```

The terminal is a grid of cells, while the desktop app draws text in a proportional font. So rows are both fitted to columns and laid out with flexible boxes, and the speed graph is drawn with block characters in the terminal and as a vector that stretches to the row's width everywhere else.

## License

[MIT](LICENSE). Made by İlyas Saltay · [ilyassaltay.com](https://ilyassaltay.com)

Built together with Claude Code; validation and tests are in the repository.
