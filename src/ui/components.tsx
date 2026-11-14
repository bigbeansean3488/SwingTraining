import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { href, navigate } from '../lib/router';

export function Page(props: {
  title: string;
  back?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="page">
      <header className="page-header">
        {props.back !== undefined ? (
          <button
            className="icon-btn"
            aria-label="返回"
            onClick={() => (props.back ? navigate(props.back) : history.back())}
          >
            ‹
          </button>
        ) : (
          <span className="icon-spacer" />
        )}
        <h1>{props.title}</h1>
        <div className="page-actions">{props.actions}</div>
      </header>
      <main className="page-body">{props.children}</main>
    </div>
  );
}

export function Card(props: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${props.className ?? ''}`}>
      {props.title ? <h2 className="card-title">{props.title}</h2> : null}
      {props.children}
    </section>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({
  variant = 'primary',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`btn btn-${variant} ${className ?? ''}`} {...rest} />;
}

export function LinkButton(props: { to: string; children: ReactNode; variant?: Variant }) {
  return (
    <a className={`btn btn-${props.variant ?? 'primary'}`} href={href(props.to)}>
      {props.children}
    </a>
  );
}

export function Field(props: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint ? <span className="field-hint">{props.hint}</span> : null}
    </label>
  );
}

export function Notice(props: { kind?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  return (
    <div
      className={`notice notice-${props.kind ?? 'info'}`}
      role={props.kind === 'error' ? 'alert' : undefined}
    >
      {props.children}
    </div>
  );
}

export function Empty(props: { children: ReactNode }) {
  return <p className="empty">{props.children}</p>;
}

export function Badge(props: { children: ReactNode; kind?: 'ok' | 'warn' | 'error' | 'muted' }) {
  return <span className={`badge badge-${props.kind ?? 'muted'}`}>{props.children}</span>;
}

export function Tabs<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="tabs" role="tablist">
      {props.options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={props.value === o.value}
          className={props.value === o.value ? 'tab active' : 'tab'}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ListLink(props: {
  to: string;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <a className="list-item" href={href(props.to)}>
      <div className="list-main">
        <div className="list-title">{props.title}</div>
        {props.subtitle ? <div className="list-sub">{props.subtitle}</div> : null}
      </div>
      {props.right ? (
        <div className="list-right">{props.right}</div>
      ) : (
        <span className="chev">›</span>
      )}
    </a>
  );
}
