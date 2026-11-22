import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseEventLogs, parseUnits, zeroAddress, zeroHash, type Hash } from "viem";

import { revertOf, termsHashOf, txHashOf } from "./helpers";

const SEPOLIA = 11_155_111n;
const HSK_TESTNET = 133n;

describe("NodReceipts", function () {
  async function deployFixture() {
    const [recorder, otherRecorder, payerWallet, payToWallet] = await hre.viem.getWalletClients();
    const receipts = await hre.viem.deployContract("NodReceipts");
    const receiptsAsOther = await hre.viem.getContractAt("NodReceipts", receipts.address, {
      client: { wallet: otherRecorder },
    });
    const publicClient = await hre.viem.getPublicClient();
    return {
      receipts,
      receiptsAsOther,
      publicClient,
      recorder: getAddress(recorder.account.address),
      otherRecorder: getAddress(otherRecorder.account.address),
      payer: getAddress(payerWallet.account.address),
      payTo: getAddress(payToWallet.account.address),
    };
  }

  type Fixture = Awaited<ReturnType<typeof deployFixture>>;

  async function mined({ publicClient }: Fixture, hash: Hash) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    return { receipt, timestamp: block.timestamp };
  }

  describe("anchor", function () {
    it("emits Anchored and stores the receipt", async function () {
      const f = await loadFixture(deployFixture);
      const termsHash = termsHashOf("coffee");
      const settlementTx = txHashOf("coffee");
      const amount = parseUnits("4.20", 6);

      const { receipt, timestamp } = await mined(
        f,
        await f.receipts.write.anchor([termsHash, settlementTx, SEPOLIA, f.payer, f.payTo, amount]),
      );

      const events = parseEventLogs({ abi: f.receipts.abi, logs: receipt.logs, eventName: "Anchored" });
      expect(events).to.have.lengthOf(1);
      expect(getAddress(events[0].address)).to.equal(getAddress(f.receipts.address));
      expect(events[0].args).to.deep.equal({
        recorder: f.recorder,
        termsHash,
        settlementTx,
        chainId: SEPOLIA,
        payer: f.payer,
        payTo: f.payTo,
        amount,
      });

      expect(await f.receipts.read.receiptOf([f.recorder, termsHash])).to.deep.equal({
        settlementTx,
        chainId: SEPOLIA,
        payer: f.payer,
        payTo: f.payTo,
        amount,
        anchoredAt: timestamp,
      });
    });

    it("reports receiptOf/isAnchored before and after anchoring", async function () {
      const f = await loadFixture(deployFixture);
      const termsHash = termsHashOf("lunch");

      expect(await f.receipts.read.isAnchored([f.recorder, termsHash])).to.equal(false);
      expect(await f.receipts.read.receiptOf([f.recorder, termsHash])).to.deep.equal({
        settlementTx: zeroHash,
        chainId: 0n,
        payer: zeroAddress,
        payTo: zeroAddress,
        amount: 0n,
        anchoredAt: 0n,
      });

      await mined(f, await f.receipts.write.anchor([termsHash, txHashOf("lunch"), HSK_TESTNET, f.payer, f.payTo, 1n]));

      expect(await f.receipts.read.isAnchored([f.recorder, termsHash])).to.equal(true);
      expect((await f.receipts.read.receiptOf([f.recorder, termsHash])).chainId).to.equal(HSK_TESTNET);
      // The receipt lives in the recorder's namespace only.
      expect(await f.receipts.read.isAnchored([f.otherRecorder, termsHash])).to.equal(false);
    });

    it("reverts with AlreadyAnchored when the same recorder anchors a termsHash twice", async function () {
      const f = await loadFixture(deployFixture);
      const termsHash = termsHashOf("twice");
      const settlementTx = txHashOf("twice");
      await mined(f, await f.receipts.write.anchor([termsHash, settlementTx, SEPOLIA, f.payer, f.payTo, 100n]));

      expect(
        await revertOf(
          f.receipts.write.anchor([termsHash, txHashOf("twice-again"), SEPOLIA, f.payer, f.payTo, 999n]),
          f.receipts.abi,
        ),
      ).to.deep.equal({ errorName: "AlreadyAnchored", args: [f.recorder, termsHash] });

      // The original receipt is untouched.
      const stored = await f.receipts.read.receiptOf([f.recorder, termsHash]);
      expect(stored.settlementTx).to.equal(settlementTx);
      expect(stored.amount).to.equal(100n);
    });

    it("lets a different recorder anchor the same termsHash independently", async function () {
      const f = await loadFixture(deployFixture);
      const termsHash = termsHashOf("shared");

      await mined(f, await f.receipts.write.anchor([termsHash, txHashOf("by-vendor"), SEPOLIA, f.payer, f.payTo, 5n]));
      const { receipt } = await mined(
        f,
        await f.receiptsAsOther.write.anchor([termsHash, txHashOf("by-server"), HSK_TESTNET, f.payer, f.payTo, 7n]),
      );

      const [event] = parseEventLogs({ abi: f.receipts.abi, logs: receipt.logs, eventName: "Anchored" });
      expect(event.args.recorder).to.equal(f.otherRecorder);

      const mine = await f.receipts.read.receiptOf([f.recorder, termsHash]);
      const theirs = await f.receipts.read.receiptOf([f.otherRecorder, termsHash]);
      expect([mine.settlementTx, mine.chainId, mine.amount]).to.deep.equal([txHashOf("by-vendor"), SEPOLIA, 5n]);
      expect([theirs.settlementTx, theirs.chainId, theirs.amount]).to.deep.equal([txHashOf("by-server"), HSK_TESTNET, 7n]);
      expect(await f.receipts.read.isAnchored([f.recorder, termsHash])).to.equal(true);
      expect(await f.receipts.read.isAnchored([f.otherRecorder, termsHash])).to.equal(true);
    });
  });

  describe("anchorBatch", function () {
    it("anchors every entry and emits one Anchored per entry", async function () {
      const f = await loadFixture(deployFixture);
      const labels = ["a", "b", "c"];
      const termsHashes = labels.map(termsHashOf);
      const settlementTxs = labels.map(txHashOf);
      const chainIds = [SEPOLIA, HSK_TESTNET, SEPOLIA];
      const payers = [f.payer, f.payer, f.otherRecorder];
      const payTos = [f.payTo, f.otherRecorder, f.payTo];
      const amounts = [1n, 20n, 300n];

      const { receipt, timestamp } = await mined(
        f,
        await f.receipts.write.anchorBatch([termsHashes, settlementTxs, chainIds, payers, payTos, amounts]),
      );

      const events = parseEventLogs({ abi: f.receipts.abi, logs: receipt.logs, eventName: "Anchored" });
      expect(events.map((e) => e.args)).to.deep.equal(
        labels.map((_, i) => ({
          recorder: f.recorder,
          termsHash: termsHashes[i],
          settlementTx: settlementTxs[i],
          chainId: chainIds[i],
          payer: payers[i],
          payTo: payTos[i],
          amount: amounts[i],
        })),
      );

      for (const [i, termsHash] of termsHashes.entries()) {
        expect(await f.receipts.read.receiptOf([f.recorder, termsHash])).to.deep.equal({
          settlementTx: settlementTxs[i],
          chainId: chainIds[i],
          payer: payers[i],
          payTo: payTos[i],
          amount: amounts[i],
          anchoredAt: timestamp,
        });
      }
    });

    it("reverts with LengthMismatch when the arrays differ in length", async function () {
      const f = await loadFixture(deployFixture);
      const two = [termsHashOf("x"), termsHashOf("y")];
      const txs = [txHashOf("x"), txHashOf("y")];

      expect(
        await revertOf(
          f.receipts.write.anchorBatch([two, txs, [SEPOLIA, SEPOLIA], [f.payer, f.payer], [f.payTo, f.payTo], [1n]]),
          f.receipts.abi,
        ),
      ).to.deep.equal({ errorName: "LengthMismatch", args: [] });
      expect(
        await revertOf(
          f.receipts.write.anchorBatch([two, [txs[0]], [SEPOLIA, SEPOLIA], [f.payer, f.payer], [f.payTo, f.payTo], [1n, 2n]]),
          f.receipts.abi,
        ),
      ).to.deep.equal({ errorName: "LengthMismatch", args: [] });
      expect(await f.receipts.read.isAnchored([f.recorder, two[0]])).to.equal(false);
    });

    it("is all-or-nothing when an entry is already anchored", async function () {
      const f = await loadFixture(deployFixture);
      const dup = termsHashOf("dup");
      const fresh = termsHashOf("fresh");

      expect(
        await revertOf(
          f.receipts.write.anchorBatch([
            [fresh, dup, dup],
            [txHashOf("1"), txHashOf("2"), txHashOf("3")],
            [SEPOLIA, SEPOLIA, SEPOLIA],
            [f.payer, f.payer, f.payer],
            [f.payTo, f.payTo, f.payTo],
            [1n, 2n, 3n],
          ]),
          f.receipts.abi,
        ),
      ).to.deep.equal({ errorName: "AlreadyAnchored", args: [f.recorder, dup] });
      expect(await f.receipts.read.isAnchored([f.recorder, fresh])).to.equal(false);
    });
  });
});
