import { BrandMark } from './BrandMark';
import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';
import './ErrorBoundary.css';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };
  private recovery = createRef<HTMLElement>();
  private reopenAttempts = 0;

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[FlowSense] UI error:', error, info);
    this.recovery.current?.focus({ preventScroll: true });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main ref={this.recovery} className="fs-workspace-recovery fs-brand-loading" tabIndex={-1} aria-labelledby="workspace-recovery-title">
          <div className="fs-workspace-recovery-card"><BrandMark size={54} />
          <span className="fs-workspace-recovery-eyebrow">FLOWSENSE WORKSPACE</span>
          <h1 id="workspace-recovery-title">The workspace could not be displayed</h1>
          <p role="alert">An interface error interrupted this view. You can try reopening the workspace.</p>
          <p className="fs-workspace-recovery-note">If you were saving a change, check its recorded status before submitting it again. An interface error does not confirm whether that request completed.</p>
          {this.reopenAttempts > 0 && <p>If this error keeps returning, reloading the page can request fresh interface resources.</p>}
          <div className="fs-workspace-recovery-actions"><button
            type="button"
            onClick={() => {
              this.reopenAttempts += 1;
              this.setState({ hasError: false }, () => requestAnimationFrame(() => {
                const heading = document.querySelector<HTMLElement>('#product-content [data-journey-active="true"] h1');
                const destination = heading || document.getElementById('product-content');
                if (destination && !destination.hasAttribute('tabindex')) destination.tabIndex = -1;
                destination?.focus({ preventScroll: true });
              }));
            }}
            className="fs-workspace-recovery-button"
          >
            Reopen workspace
          </button>
          {this.reopenAttempts > 0 && <button type="button" className="fs-workspace-recovery-button secondary" onClick={() => window.location.reload()}>Reload page</button>}</div>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
