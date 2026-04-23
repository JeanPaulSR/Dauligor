import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      let errorMessage = "An unexpected error occurred.";
      let diagnosticInfo = null;

      try {
        if (this.state.error?.message) {
          const parsed = JSON.parse(this.state.error.message);
          if (parsed.error) {
            errorMessage = parsed.error;
            diagnosticInfo = parsed;
          }
        }
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-[400px] flex items-center justify-center p-6">
          <Card className="max-w-md w-full border-blood/20 bg-blood/5 backdrop-blur-sm">
            <CardHeader className="text-center">
              <div className="w-12 h-12 bg-blood/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-6 h-6 text-blood" />
              </div>
              <CardTitle className="text-blood font-serif text-2xl">Archive Error</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 text-center">
              <p className="text-ink/70 font-serif italic">
                {errorMessage}
              </p>
              
              {diagnosticInfo && (
                <div className="text-left bg-black/5 p-3 rounded text-[10px] font-mono overflow-auto max-h-32">
                  <pre>{JSON.stringify(diagnosticInfo, null, 2)}</pre>
                </div>
              )}

              <Button 
                onClick={this.handleReset}
                className="bg-blood hover:bg-blood/90 text-white gap-2"
              >
                <RefreshCw className="w-4 h-4" /> Reload Archive
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
