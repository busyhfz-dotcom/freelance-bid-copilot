type DesktopSettings = { panelUrl: string; version: string; platform: string };

type DesktopBridge = {
  isDesktop: true;
  getSettings(): Promise<DesktopSettings>;
  setPanelUrl(url: string): Promise<DesktopSettings>;
  getAdapterScripts(): Promise<{ revision: string; bundle: string }>;
  recoverMarketplace(): Promise<boolean>;
  reloadMarketplace(): Promise<boolean>;
  stopMarketplace(): Promise<boolean>;
  onFocusAddress(callback: () => void): () => void;
  reloadWorkspace(): Promise<boolean>;
};

declare global {
  interface ElectronWebviewElement extends HTMLElement {
    getURL(): string;
    isLoading(): boolean;
    canGoBack(): boolean;
    canGoForward(): boolean;
    loadURL(url: string): Promise<void>;
    goBack(): void;
    goForward(): void;
    reload(): void;
    reloadIgnoringCache(): void;
    stop(): void;
    executeJavaScript<T = unknown>(code: string): Promise<T>;
  }

  interface Window {
    bidCopilotDesktop?: DesktopBridge;
  }
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<ElectronWebviewElement>, ElectronWebviewElement> & {
        src?: string;
        partition?: string;
      };
    }
  }
}

export {};
