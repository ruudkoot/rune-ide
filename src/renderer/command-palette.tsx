import React, { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Heading, Input, Label, ListBox, ListBoxItem, Modal, ModalOverlay, Text, TextField } from 'react-aria-components';
import { Command, CommandContext, CommandInfo } from '../shared/protocol';

export function CommandPalette({ context, close, execute }: { context: CommandContext; close: () => void; execute: (command: Command) => void }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<CommandInfo[]>([]);
  const [error, setError] = useState('');
  const pendingEnter = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const serialized = JSON.stringify(context);
  useEffect(() => {
    let current = true;
    setRows([]);
    void window.rune.request<CommandInfo[]>('commands/list', { query, context }).then(rows => {
      if (current) {
        const next = rows.filter(row => row.id !== 'palette'); setRows(next); setError('');
        if (pendingEnter.current) {
          pendingEnter.current = false; const first = next.find(row => row.enabled);
          if (first) { close(); requestAnimationFrame(() => execute(first.id)); }
        }
      }
    }).catch(error => { if (current) setError(error.message); });
    return () => { current = false; };
  }, [query, serialized]);
  const choose = (id: Command) => {
    if (!rows.some(row => row.id === id && row.enabled)) return;
    close();
    // Let the dialog restore focus before a focus command selects its destination.
    requestAnimationFrame(() => execute(id));
  };
  return <ModalOverlay isOpen isDismissable onOpenChange={open => { if (!open) close(); }}>
    <Modal><Dialog aria-label="Command palette">
      <Heading slot="title">Command palette</Heading>
      <TextField value={query} onChange={value => { pendingEnter.current = false; setRows([]); setQuery(value); }}>
        <Label>Search commands</Label>
        <Input autoFocus maxLength={128} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'ArrowDown') { event.preventDefault(); list.current?.focus(); }
          if (event.key === 'Enter') { event.preventDefault(); const first = rows.find(row => row.enabled); if (first) choose(first.id); else if (!rows.length) pendingEnter.current = true; }
        }} />
      </TextField>
      <p className="palette-hint">Enter runs the first available command. Down arrow browses results.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <ListBox ref={list} aria-label="Commands" items={rows} disabledKeys={rows.filter(row => !row.enabled).map(row => row.id)} onAction={id => choose(id as Command)} renderEmptyState={() => 'No commands found'}>
        {row => <ListBoxItem id={row.id} textValue={row.label}><Text slot="label">{row.category}: {row.label}</Text><Text slot="description">{row.shortcut.replace('CmdOrCtrl', /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl')}</Text></ListBoxItem>}
      </ListBox>
      <div className="dialog-buttons"><Button onPress={close}>Cancel</Button></div>
    </Dialog></Modal>
  </ModalOverlay>;
}
