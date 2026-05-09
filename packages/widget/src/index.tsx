import './styles.css';
import magiSvg from './assets/magi.svg';

export { MagiNftPanel, type MagiNftPanelProps } from './NftPanel.js';
/**
 * Inlined Magi logo as a data URL - same image the panels use as a tile
 * fallback when no NFT image can be resolved. Re-exported so headless
 * integrators rendering their own tiles can match the look without
 * pulling the file from the magi.eco origin.
 */
export const magiFallbackImage: string = magiSvg;
export { MagiTokenPanel, type MagiTokenPanelProps } from './TokenPanel.js';
export { MagiAssets } from './MagiAssets.js';
export { NftActionButton, type NftActionButtonProps } from './NftActionButton.js';
export { NftTransferForm, type NftTransferFormProps } from './actions/NftTransferForm.js';
export { NftBurnForm, type NftBurnFormProps } from './actions/NftBurnForm.js';
export { NftBatchTransferForm, type NftBatchTransferFormProps } from './actions/NftBatchTransferForm.js';
export { TokenTransferForm, type TokenTransferFormProps } from './actions/TokenTransferForm.js';
export { TokenBurnForm, type TokenBurnFormProps } from './actions/TokenBurnForm.js';
