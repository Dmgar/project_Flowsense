import { BrandMark } from './BrandMark';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[FlowSense] UI error:', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 fs-brand-loading font-mono">
          <BrandMark size={54} /><div className="text-2xl font-bold text-accent-red">SYSTEM ERROR</div>
          <div className="text-xs text-text-muted">The Command Center interface encountered an error.</div>
          <button
            onClick={() => {
              this.setState({ hasError: false });
            }}
            className="mt-2 rounded border border-accent-cyan bg-accent-cyan/10 px-4 py-1.5 text-xs text-accent-cyan"
          >

            RESTART INTERFACE
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
