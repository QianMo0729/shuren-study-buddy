import { useNavigate } from 'react-router';
import { Button } from '../components/ui';
import { Illustration } from '../components/brand';

export function NotFound() {
  const nav = useNavigate();
  return (
    <div className="grid min-h-[70dvh] place-items-center px-6 text-center">
      <div>
        <Illustration name="mascot-lost" className="mx-auto mb-4 size-36" />
        <p className="text-[15px] text-ink-3">404</p>
        <h1 className="mt-1 text-[22px] font-semibold text-ink">没有找到这个页面</h1>
        <p className="mt-1.5 text-[15px] text-ink-2">链接可能写错了，或者内容已经被删除。</p>
        <Button variant="primary" className="mt-6" onClick={() => nav('/square')}>
          回到搭子广场
        </Button>
      </div>
    </div>
  );
}
