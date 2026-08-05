/**
 * ErrorBoundary — catches runtime errors in child components so a single
 * broken route doesn't blank the entire tab. Shows the error + stack
 * inline so the user can screenshot it and we know what to fix.
 *
 * Wrap each route in <ErrorBoundary label="Overview"><Route/></ErrorBoundary>
 * so we can pinpoint which tab crashed.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  label: string
  children: ReactNode
}

interface State {
  error: Error | null
  info: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to console so it shows up in browser DevTools too
    console.error(`[ErrorBoundary:${this.props.label}]`, error, info)
    this.setState({ info })
  }

  reset = () => this.setState({ error: null, info: null })

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children
    return (
      <div className="p-6 max-w-3xl mx-auto text-text font-sans">
        <div className="bg-sunken border border-status-skip/40 rounded-lg p-4">
          <div className="flex items-baseline gap-3 mb-2">
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-status-skip/20 text-status-skip uppercase tracking-wider">
              Route crash
            </span>
            <h2 className="text-[18px] font-medium">
              {this.props.label} tab failed to render
            </h2>
          </div>
          <p className="text-text-3 text-[13px] mb-4">
            A runtime error prevented this tab from rendering. Screenshot this
            block and share it — the message + first stack frame usually
            identifies the fix.
          </p>
          <div className="bg-app rounded p-3 mb-3 font-mono text-[12px] text-status-skip whitespace-pre-wrap break-words">
            {error.name}: {error.message}
          </div>
          {error.stack && (
            <details className="mb-3">
              <summary className="cursor-pointer text-text-3 text-[12px] mb-2">
                Stack trace
              </summary>
              <div className="bg-app rounded p-3 font-mono text-[11px] text-text-3 whitespace-pre-wrap break-all max-h-64 overflow-auto">
                {error.stack}
              </div>
            </details>
          )}
          {info?.componentStack && (
            <details className="mb-3">
              <summary className="cursor-pointer text-text-3 text-[12px] mb-2">
                Component tree
              </summary>
              <div className="bg-app rounded p-3 font-mono text-[11px] text-text-3 whitespace-pre-wrap break-all max-h-64 overflow-auto">
                {info.componentStack}
              </div>
            </details>
          )}
          <button
            onClick={this.reset}
            className="mt-2 px-3 py-1.5 rounded-md border border-accent text-accent-lt text-[13px] hover:bg-accent/10"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }
}
