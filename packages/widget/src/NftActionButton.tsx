import { useState } from 'react';
import {
	createNftClient,
	MAINNET_CONFIG,
	type AiohaLike,
	type BroadcastHook,
	type MagiConfig,
	type NftClient,
	type NftItem
} from '@vsc.eco/nft-sdk';
import { NftTransferForm } from './actions/NftTransferForm.js';
import { NftBurnForm } from './actions/NftBurnForm.js';

export interface NftActionButtonProps {
	username?: string;
	aioha?: AiohaLike;
	onBroadcast?: BroadcastHook;
	keyType?: unknown;
	config?: MagiConfig;
	client?: NftClient;
	item: NftItem;
	action: 'transfer' | 'burn';
	label?: string;
	onSuccess?: (txId: string) => void;
	className?: string;
}

/**
 * Drop-in single-action button for hosts that already render their own
 * NFT list and just want a "Transfer" or "Burn" CTA per item, with the
 * SDK-provided form modal. Renders a `.magi-nft` card so the modal has
 * positioning context, but the card body is invisible (just the button).
 */
export function NftActionButton(props: NftActionButtonProps) {
	const {
		username,
		aioha,
		onBroadcast,
		keyType,
		config = MAINNET_CONFIG,
		client: providedClient,
		item,
		action,
		label,
		onSuccess,
		className
	} = props;
	const client = providedClient ?? createNftClient({ config, aioha, onBroadcast, keyType });
	const [open, setOpen] = useState(false);
	const buttonLabel = label ?? (action === 'transfer' ? 'Transfer' : 'Burn');
	return (
		<div
			className={`magi-nft ${className ?? ''}`}
			style={{ display: 'inline-block', padding: 0, border: 0, background: 'transparent', boxShadow: 'none' }}
		>
			<button
				type="button"
				className={action === 'burn' ? 'magi-nft-submit danger' : 'magi-nft-submit'}
				disabled={!username}
				onClick={() => setOpen(true)}
				style={{ width: 'auto', padding: '0.5rem 1rem' }}
			>
				{buttonLabel}
			</button>
			{open && username && action === 'transfer' && (
				<NftTransferForm
					client={client}
					username={username}
					item={item}
					onSuccess={(tx) => {
						onSuccess?.(tx);
						setOpen(false);
					}}
					onClose={() => setOpen(false)}
				/>
			)}
			{open && username && action === 'burn' && (
				<NftBurnForm
					client={client}
					username={username}
					item={item}
					onSuccess={(tx) => {
						onSuccess?.(tx);
						setOpen(false);
					}}
					onClose={() => setOpen(false)}
				/>
			)}
		</div>
	);
}
