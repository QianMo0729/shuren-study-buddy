import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import type { PublicProfile } from '../../shared/types';
import { api } from '../lib/api';
import { Button } from '../components/ui';
import { ProfileDetail } from '../components/ProfileDetail';
import { Illustration } from '../components/brand';

export function ProfilePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProfile(null);
    setError(null);
    api.profile(Number(id)).then((r) => setProfile(r.profile)).catch((e) => setError(e.message));
  }, [id]);

  return (
    <div className="pt-5 sm:pt-8">
      <button onClick={() => (history.length > 1 ? nav(-1) : nav('/square'))} className="-ml-1 mb-4 inline-flex items-center gap-0.5 text-[14px] text-ink-2 hover:text-ink">
        <ChevronLeft size={17} /> 返回
      </button>
      {error ? (
        <div className="flex flex-col items-center py-24 text-center">
          <Illustration name="mascot-empty" className="mb-4 size-32" />
          <p className="text-[16px] font-semibold text-ink">{error}</p>
          <Button className="mt-5" onClick={() => nav('/square')}>
            去搭子广场看看
          </Button>
        </div>
      ) : profile ? (
        <div className="overflow-hidden rounded-xl bg-surface md:p-6">
          {profile.takenDown && <p className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-[14px] text-danger">这张主页已被撤下，只有本人和管理员能看到。</p>}
          <ProfileDetail profile={profile} />
        </div>
      ) : (
        <div className="grid gap-6 rounded-xl bg-surface p-6 md:grid-cols-2">
          <div className="skeleton aspect-[4/5] rounded-xl" />
          <div className="space-y-4">
            <div className="skeleton h-8 w-1/2 rounded-lg" />
            <div className="skeleton h-4 w-2/3 rounded" />
            <div className="skeleton h-40 rounded-2xl" />
          </div>
        </div>
      )}
    </div>
  );
}
