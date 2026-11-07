'use client';

import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { TrustBadge } from '@/components/spica/ApiCard';
import { formatUsd } from '@/lib/money';
import { networkByCaip2 } from '@/lib/networks';
import { categoryMeta, type Service } from './meta';

const ROWS: [string, (service: Service) => React.ReactNode][] = [
  ['Price', (service) => <strong>{service.listedMicros ? `${formatUsd(service.listedMicros)} USDC` : 'Unpriced'}</strong>],
  ['Provider', (service) => service.providerName],
  ['Category', (service) => categoryMeta(service.category).label],
  ['Networks', (service) => [...new Set(service.allNetworks.flatMap((id) => networkByCaip2(id)?.label ?? []))].join(', ') || 'None enabled'],
  ['Circle Gateway', (service) => (service.supportsGateway ? 'Yes' : 'No')],
  ['Measured calls', (service) => service.reputation.sampleSize],
  ['Trust', (service) => <TrustBadge service={service} />],
];

export function CompareDialog({ open, services, onClose }: { open: boolean; services: Service[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="s-dialog" aria-labelledby="compare-title" onClose={onClose} onClick={(event) => event.target === ref.current && ref.current?.close()}>
      <div className="flex items-center justify-between gap-3 border-b-[3px] border-[#111] bg-[var(--yellow)] px-5 py-3">
        <h2 id="compare-title" className="s-display text-2xl">Compare services</h2>
        <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded-lg p-1.5 hover:bg-white/50"><X size={20} aria-hidden /></button>
      </div>
      <div className="overflow-x-auto">
        <table className="s-compare">
          <thead>
            <tr>
              <td />
              {services.map((service) => <th key={service.id} scope="col">{service.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([label, cell]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {services.map((service) => <td key={service.id}>{cell(service)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </dialog>
  );
}
