# Changelog

## 1.2.0

- The pane is in English by default and also speaks Turkish: `/kod-akisi tr` switches, `/kod-akisi en` switches back, and the choice is remembered across sessions. Numbers follow the language (`3.4 s` / `3,4 sn`).
- `/kod-akisi off` closes the pane; `/kod-akisi kapat` still works.
- English README is now the default one, with the one-line install. Turkish is in `README.tr.md`.
- Checked on Claude Code 2.1.325. The layout test now runs in both languages.

Upgrading from 1.1: the pane opens in English. Type `/kod-akisi tr` once to keep it in Turkish.

## 1.1.1

- Speed graph: one large spike no longer flattens the other bars, and the history is kept between turns.
- In a narrow pane the agent row keeps only the elapsed time.

## 1.1.0

- The speed graph is drawn as a vector on the desktop app, so it stays on one line at any width.
- Thinking text streams in a box of its own.
- Subagents: one row each, the agent's name on the stage, colored marks in the log, background agents.

## 1.0.0

- First release: a live pane for the code Claude writes, edits as a live diff, commands with their output.
