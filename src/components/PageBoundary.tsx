import { Component, type ReactNode } from 'react';
import { Illustration } from './brand';
import { Button, Empty } from './ui';

/** 页面分块加载失败（多半是网络问题）时显示重试，而不是让整个应用变成白屏 */
export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <Empty
          art={<Illustration name="mascot-empty" className="mb-4 size-24" />}
          title="页面暂时没有加载出来"
          desc="可能是网络不太稳定，刷新一下再试试。"
          action={<Button variant="primary" onClick={() => window.location.reload()}>刷新页面</Button>}
        />
      </div>
    );
  }
}
