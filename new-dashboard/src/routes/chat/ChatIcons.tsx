import type { ReactNode } from 'react';

export function ChatLogo() {
  return <svg aria-hidden="true" className="chat-logo" focusable="false" viewBox="0 0 24 24"><path d="M11.96 2.6c.22-.53.97-.53 1.19 0l.76 1.84a7.05 7.05 0 0 0 3.72 3.77l1.75.78c.53.23.53 1 0 1.23l-1.81.8a6.86 6.86 0 0 0-3.66 3.68l-.76 1.75c-.22.52-.97.52-1.19 0l-.75-1.75a6.86 6.86 0 0 0-3.66-3.68l-1.81-.8a.67.67 0 0 1 0-1.23l1.75-.78a7.05 7.05 0 0 0 3.72-3.77l.75-1.84Z" fill="currentColor"/><path d="M18.72 15.2c.12-.3.54-.3.67 0l.3.73c.4.96 1.15 1.72 2.1 2.14l.63.28c.3.13.3.56 0 .69l-.67.3a3.5 3.5 0 0 0-2.06 2.06l-.3.68c-.13.3-.55.3-.68 0l-.3-.68a3.5 3.5 0 0 0-2.05-2.06l-.68-.3a.38.38 0 0 1 0-.69l.64-.28a3.7 3.7 0 0 0 2.1-2.14l.3-.73Z" fill="currentColor"/></svg>;
}

function SidebarIcon({ children }: { children: ReactNode }) {
  return <svg aria-hidden="true" className="chat-sidebar-icon" fill="none" focusable="false" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">{children}</svg>;
}

export function PanelLeftIcon() {
  return <SidebarIcon><rect height="18" rx="2" width="18" x="3" y="3"/><path d="M9 3v18"/></SidebarIcon>;
}

export function BoxIcon() {
  return <SidebarIcon><path d="m21 8-9 5-9-5"/><path d="m3 8 9-5 9 5v8l-9 5-9-5Z"/><path d="M12 13v8"/></SidebarIcon>;
}

export function SquarePenIcon() {
  return <SidebarIcon><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></SidebarIcon>;
}

export function PencilIcon() {
  return <SidebarIcon><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></SidebarIcon>;
}

export function TrashIcon() {
  return <SidebarIcon><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></SidebarIcon>;
}

export function PlusIcon() {
  return <SidebarIcon><path d="M12 5v14M5 12h14"/></SidebarIcon>;
}
