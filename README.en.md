# Kod Akışı (Code Stream)

A Claude Code plugin that shows the code Claude is writing, live, in a side pane. · [Türkçe](README.md)

![Kod Akışı pane: code streaming line by line, a typing-speed sparkline and an activity log](assets/onizleme.svg)

<sub>The preview is an illustration; the pane is drawn with Claude Code's own font and color theme.</sub>

While Claude writes a file you usually see a spinner and collapsed rows. Kod Akışı streams the code into a pane beside the conversation as the model produces it: files with line numbers and syntax colors, edits as a live diff, commands with the tail of their output.

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
claude plugin marketplace add Ilyas-jpg/kod-akisi
claude plugin install kod-akisi@ilyassaltay
```

Use only one of the two. If both are installed, Claude Code loads the first plugin of that name.

## Use

The pane opens by itself in a new session. `/kod-akisi` opens it, `/kod-akisi kapat` closes it and stops it from opening automatically.

## How it works

Kod Akışı runs on Claude Code's mod system (function hooks). It listens to the model's response stream on `turn.step`, decodes tool arguments from their partial JSON and draws the pane. It never changes the stream or a tool result; every chunk passes through as it came.

It makes no network, file system or process calls. Everything it asks of the engine: opening and closing its pane, keeping its own state and one preference, timers, registering its command, a toast and one line in the debug log. `claude plugin validate .` reads that list off the source.

## Limits

- The mod system is early access and may change with a Claude Code update. If it does, the pane does not appear; the session itself is unaffected.
- The interface is in Turkish.
- Used on the Windows desktop app and exercised on the terminal surface through Claude Code's test kit. Nothing in the code is specific to an operating system, so it is expected to work on macOS and Linux; it has not been tried there yet.

## Develop

```bash
claude plugin validate .
claude plugin test .
```

## License

[MIT](LICENSE). Made by İlyas Saltay · [ilyassaltay.com](https://ilyassaltay.com)

Built together with Claude Code; validation and tests are in the repository.
