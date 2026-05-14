import type { ReactNode } from 'react';

interface ModalProps {
	title: string;
	subtitle?: string;
	onClose: () => void;
	children: ReactNode;
	/** Render a wider card — used by the NFT details modal for the big image. */
	wide?: boolean;
}

/**
 * Inline-positioned modal that overlays its closest `.magi-token` ancestor.
 * Lifted out so every action form (transfer, burn, batch transfer, ...)
 * shares the same chrome. Inputs match the swap widget's modal pattern
 * (`.magi-qs-rc-modal-card` from crosschain-widget) so themes apply
 * consistently across both widgets.
 */
export function Modal({ title, subtitle, onClose, children, wide }: ModalProps) {
	return (
		<div className="magi-token-modal" role="dialog" aria-modal="true" onClick={onClose}>
			<div
				className={`magi-token-modal-card${wide ? ' magi-token-modal-card--wide' : ''}`}
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="magi-token-modal-title">
					<span>{title}</span>
					<button
						type="button"
						className="magi-token-modal-close"
						onClick={onClose}
						aria-label="Close"
					>
						✕
					</button>
				</h3>
				{subtitle && <p className="magi-token-modal-subtitle">{subtitle}</p>}
				{children}
			</div>
		</div>
	);
}
