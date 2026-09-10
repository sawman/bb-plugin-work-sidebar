# BBPLUG-393 — Inbox answers while work continues

## Outcome

The provider-neutral agent configuration now explicitly instructs an agent to
leave its answer in Inbox when the user asks a question and requested work
still remains, then continue that work rather than stopping after the answer.

## RED/GREEN

A fake-host registration test first failed against both the exported Inbox
instruction and the actual combined dynamic agent configuration. The new
sentence is now emitted through the existing `bb.agents.configure` provider
for every configured agent family.

## Verification

Final tests, build, reload, commit, and push evidence are recorded on the
durable task.
