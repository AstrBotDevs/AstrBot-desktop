import type { PropsWithChildren } from 'react';
import { Outlet } from 'react-router-dom';

export function BlankLayout({ children }: PropsWithChildren) {
  return (
    <div className="blank-layout" data-layout="blank">
      {children ?? <Outlet />}
    </div>
  );
}
