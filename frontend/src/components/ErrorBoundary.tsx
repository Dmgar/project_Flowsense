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
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-bg-primary font-mono text-text-primary">
          <div className="text-2xl font-bold text-accent-red">SISTEMA ERROR</div>
          <div className="text-xs text-text-muted">Fallo en la UI del Command Center.</div>
          <button
            onClick={() => {
              this.setState({ hasError: false });
            }}
            className="mt-2 rounded border border-accent-cyan bg-accent-cyan/10 px-4 py-1.5 text-xs text-accent-cyan"
          >
            REINICIAR INTERFAZ
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}