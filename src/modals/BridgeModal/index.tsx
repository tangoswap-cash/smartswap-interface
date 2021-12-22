import { i18n } from "@lingui/core";
import { t } from "@lingui/macro";
import { Currency } from "@mistswapdex/sdk";
import React,{Component, useEffect, useState} from "react";
import ReactDOM from "react-dom";
import { CheckCircle, Loader } from "react-feather";
import Button from "../../components/Button";
import Modal from "../../components/Modal";
import ModalHeader from "../../components/ModalHeader";
import { AutoRow } from "../../components/Row";
import Typography from "../../components/Typography";
import { formatNumber } from "../../functions";
import { BridgeChains, Chain, DEFAULT_CHAIN_FROM, DEFAULT_CHAIN_TO } from "../../pages/bridge";

import QRCode from "qrcode.react";
import { HopDirection, hopInRefresh, HopStage, HopStatus, initHopWallet, randomId, showCCTransLogs } from "../../services/hop.cash";
import { useActiveWeb3React } from "../../hooks";
import { ShiftStage, ShiftStatus, xaiOrder, xaiStatus } from "../../services/sideshift.ai";
import Dots from "../../components/Dots";
import Copy from "../../components/AccountDetails/Copy";
import { useTransactionGetter, useTransactionUpdater } from "../../state/bridgeTransactions/hooks";
import { TransactionDetails } from "../../state/bridgeTransactions/reducer";
import { ExternalLinkIcon } from "@heroicons/react/outline";

const shorten = (text: string, size = 5) => {
  if (text.length > 20) {
    return `${text.slice(0, size)}...${text.slice(-size)}`
  }
  return text
}

const needsDots = (message: string) => {
  if (message.includes("cancelled") || message.includes("arrived to destination")) {
    return false
  }
  return true
}

export interface DepositAddress {
  address: string
  destinationTag?: number
  memo?: string
}

interface BridgeModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  // currency0?: Currency;
  // currencyAmount?: string;
  // chainFrom?: Chain;
  // chainTo?: Chain;
  // methodId?: string;
  hash: string
}

export default function BridgeModal({
  isOpen,
  onDismiss,
  // currency0,
  // currencyAmount,
  // chainFrom,
  // chainTo,
  // methodId,
  hash
}: BridgeModalProps) {
  const [statusText, setStatusText] = useState<string | null>("Initializing")

  const transactionGetter = useTransactionGetter;
  const transactionUpdater = useTransactionUpdater();

  const { library: provider } = useActiveWeb3React()
  let bridgeTransaction = transactionGetter(hash) || {} as TransactionDetails;

  const { methodId, srcChainId, destChainId, symbol, initialAmount } = bridgeTransaction
  const chainFrom = BridgeChains[srcChainId]
  const chainTo = BridgeChains[destChainId]

  const address = (window.shiftStatus || {}).depositAddress || (window.hopStatus || {}).depositAddress || null
  const [depositAddress, setDepositAddress] = useState<string | null>(address)
  const [memo, setMemo] = useState<string | null>(null)
  const [destinationTag, setDestinationTag] = useState<number | null>(null)
  const [sideShiftOrderId, setSideShiftOrderId] = useState<string | null>(null)

  const [bchTransactionId, setBchTransactionId] = useState<string | null>(bridgeTransaction.hopStatus?.bchTxId)
  const [sbchTransactionId, setSbchTransactionId] = useState<string | null>(bridgeTransaction.hopStatus?.sbchTxId)

  const bridgeDirectionIn = chainFrom === DEFAULT_CHAIN_FROM && chainTo === DEFAULT_CHAIN_TO
  const bridgeDirectionOut = chainFrom === DEFAULT_CHAIN_TO && chainTo === DEFAULT_CHAIN_FROM

  const shiftNeeded = methodId !== "bch"
  const hopDirection = (chainTo === DEFAULT_CHAIN_TO) ? HopDirection.in : HopDirection.out

  window.hopStatus = {...bridgeTransaction.hopStatus}
  window.shiftStatus = {...bridgeTransaction.shiftStatus}

  useEffect(() => {
    const stateMachine = async () => {
      if (isOpen) {
        // hop.cash state machine
        const hopStatus: HopStatus = {...(window.hopStatus || {})} as HopStatus
        const shiftStatus: ShiftStatus = {...(window.shiftStatus || {})} as ShiftStatus

        switch (hopStatus.stage) {
          case undefined:
          case HopStage.init:
            const {cashAddr, fromBlock} = await initHopWallet(provider)
            // window.bridgeId = randomId();

            // bridgeTransaction = {...bridgeTransaction, ...{
            //   hash: window.bridgeId,
            //   hopStatus: {...hopStatus},
            //   shiftStatus: {...shiftStatus},
            //   addedTime: new Date().getTime(),
            //   initialAmount: initialAmount,
            //   symbol: symbol,
            //   from: await provider.getSigner().getAddress(),
            //   srcChainId: chainFrom.id,
            //   destChainId: chainTo.id,
            // }};

            // sideshift.ai state machine
            if (!shiftNeeded) {
              setDepositAddress(cashAddr)
            }
            break;
          case HopStage.deposit:
            // sideshift.ai state machine
            if (shiftNeeded) {
              switch (shiftStatus.stage) {
                case undefined:
                case ShiftStage.init:
                  const cashAddr = hopStatus.depositAddress;
                  try {
                    const order = await xaiOrder(methodId, "bch", cashAddr);
                    setDepositAddress(order.depositAddress.address)
                    if (order.depositAddress.memo) setMemo(order.depositAddress.memo);
                    if (order.depositAddress.destinationTag )setDestinationTag(order.depositAddress.destinationTag)
                    setSideShiftOrderId(order.orderId)
                  } catch (error) {
                    hopStatus.stage = HopStage.cancelled
                    console.log(error)
                    alert(error.message)
                  }
                  break;
                case ShiftStage.deposit:
                  setStatusText("Waiting for deposit");
                  break;
                case ShiftStage.confirmation:
                  setStatusText(`Waiting for ${symbol} confirmations`);
                  setDepositAddress(null)
                  break;
                case ShiftStage.settled:
                  // transition to hop cash is automatic
                  break;
              }
              if (shiftStatus.stage == ShiftStage.deposit || shiftStatus.stage == ShiftStage.confirmation) {
                // update order status and advance the state
                await xaiStatus(shiftStatus.orderId);
              }
            } else {
              setStatusText("Waiting for deposit");
            }

            await hopInRefresh(provider)
            break;
          case HopStage.sent:
            const signer = provider.getSigner();
            const ccTargetAddr = await signer.getAddress();
            await showCCTransLogs("", provider, ccTargetAddr, hopStatus.fromBlock)
            setDepositAddress(null)
            setBchTransactionId(hopStatus.bchTxId);
            setStatusText("Funds sent to the cross-chain bridge");
            break;
          case HopStage.settled:
            setSbchTransactionId(hopStatus.sbchTxId);
            setStatusText("Funds arrived to destination");
            break;
          case HopStage.cancelled:
            setStatusText("Bridge process cancelled");
            break;
        }

        if (hopStatus.stage != HopStage.settled && hopStatus.stage != HopStage.cancelled) {
          window.smTimeout = setTimeout(stateMachine, 1000)
        }

        const copy = {...bridgeTransaction}

        bridgeTransaction = {...bridgeTransaction, ...{
          hopStatus: hopStatus,
          shiftStatus: shiftStatus,
        }};

        // todo: need a better take on this
        if (bridgeTransaction.hash && JSON.stringify(copy) !== JSON.stringify(bridgeTransaction)) {
          transactionUpdater(bridgeTransaction)
        }
      }
    };
    stateMachine();
  }, [isOpen]);

  const onClose = () => {
    clearTimeout(window.smTimeout)
    isOpen = false
    onDismiss()
  }

  return (
  <>
    <Modal isOpen={isOpen} onDismiss={onClose}>
      <div className="space-y-4">
        <ModalHeader title={i18n._(t`Bridge ${symbol}`)} onClose={onClose} />
        <Typography variant="sm" className="font-medium">
          {i18n._(t`Sending ${formatNumber(initialAmount)} ${symbol} from ${chainFrom?.name} network`)}
        </Typography>

        {depositAddress && (<div>
          <div className="flex items-center justify-center">
            <QRCode size={200}  value={depositAddress} includeMargin={true} />
          </div>
          <div className="flex items-center justify-center">
            <Copy toCopy={depositAddress}>
              <Typography variant="sm">{shorten(depositAddress, 10)}</Typography>
            </Copy>
          </div>
        </div>)}
        {memo && (
          <div className="flex items-center justify-center">
            <Typography className="font-medium" variant="sm">
              Your XLM deposit must contain the memo: "{memo}", otherwise the deposit might be lost
            </Typography>
          </div>
        )}
        {destinationTag && (
          <div className="flex items-center justify-center">
            <Typography className="font-medium" variant="sm">
              Your XRP deposit must contain the Destination Tag: "{destinationTag}", otherwise the deposit will be rejected by the network
            </Typography>
          </div>
        )}

        {sideShiftOrderId && (<div>
          <div className="flex items-center justify-center">
            <a href={`https://sideshift.ai/orders/${sideShiftOrderId}`} target="_blank"
              className="flex flex-row items-center gap-1 font-bold text-baseline text-primary"
            >
              sideshift.ai order {sideShiftOrderId} <ExternalLinkIcon width={20} height={20} />
            </a>
          </div>
        </div>)}

        {bchTransactionId && (<div>
          <div className="flex items-center justify-center">
            <a href={`https://blockchair.com/bitcoin-cash/transaction/${bchTransactionId}`} target="_blank"
              className="flex flex-row items-center gap-1 font-bold text-baseline text-primary"
            >
              BCH cross-chain tx {shorten(bchTransactionId)} <ExternalLinkIcon width={20} height={20} />
            </a>
          </div>
        </div>)}

        {sbchTransactionId && (<div>
          <div className="flex items-center justify-center">
            <a href={`https://www.smartscan.cash/transaction/${sbchTransactionId}`} target="_blank"
              className="flex flex-row items-center gap-1 font-bold text-baseline text-primary"
            >
              SmartBCH cross-chain tx {shorten(sbchTransactionId)} <ExternalLinkIcon width={20} height={20} />
            </a>
          </div>
        </div>)}

        {statusText && (
          <div className="flex items-center justify-center gap-2">
            {needsDots(statusText) && (<Dots>
              {statusText}
            </Dots>)}
            {!needsDots(statusText) && (<div>{statusText}</div>)}
            {window.hopStatus.stage === HopStage.settled && (<CheckCircle className="text-2xl text-green" />)}
          </div>
        )}
      </div>
    </Modal>
  </>
  );
}
