import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import {
  getAddress,
  maxUint128,
  maxUint256,
  maxUint64,
  parseEventLogs,
  parseUnits,
  zeroAddress,
  zeroHash,
  type Hash,
} from "viem";

import { revertOf, termsHashOf } from "./helpers";

const usd = (value: string) => parseUnits(value, 6);
const DAY = 86_400n;
const CAP = usd("100");

describe("NodPolicy", function () {
  async function deployFixture() {
    const [ownerWallet, agentWallet, payeeWallet, otherPayeeWallet, strangerWallet] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();

    const token = await hre.viem.deployContract("MockERC20", ["Mock USD", "mUSD", 6]);
    const policy = await hre.viem.deployContract("NodPolicy");
    const policyAsAgent = await hre.viem.getContractAt("NodPolicy", policy.address, {
      client: { wallet: agentWallet },
    });
    const policyAsStranger = await hre.viem.getContractAt("NodPolicy", policy.address, {
      client: { wallet: strangerWallet },
    });

    const owner = getAddress(ownerWallet.account.address);
    await token.write.mint([owner, usd("1000")]);
    await token.write.approve([policy.address, maxUint256]);

    return {
      publicClient,
      token,
      policy,
      policyAsAgent,
      policyAsStranger,
      // Every error pay() can surface, including the token's own (bubbled up by SafeERC20).
      errorsAbi: [...policy.abi, ...token.abi],
      owner,
      agent: getAddress(agentWallet.account.address),
      payee: getAddress(payeeWallet.account.address),
      otherPayee: getAddress(otherPayeeWallet.account.address),
      stranger: getAddress(strangerWallet.account.address),
      tokenAddress: getAddress(token.address),
      policyAddress: getAddress(policy.address),
    };
  }

  /** deployFixture plus a 100 USD/day policy for the agent and one allowed payee. */
  async function activePolicyFixture() {
    const f = await deployFixture();
    await f.policy.write.setPolicy([f.agent, f.tokenAddress, CAP, DAY]);
    await f.policy.write.allowPayee([f.agent, f.payee, true]);
    const { periodStart } = await f.policy.read.policyOf([f.owner, f.agent, f.tokenAddress]);
    return { ...f, periodStart };
  }

  type Fixture = Awaited<ReturnType<typeof deployFixture>>;

  async function mined({ publicClient }: Fixture, hash: Hash) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).to.equal("success");
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    return { receipt, timestamp: block.timestamp };
  }

  describe("owner controls", function () {
    it("setPolicy emits PolicySet and starts a period now", async function () {
      const f = await loadFixture(deployFixture);
      const { receipt, timestamp } = await mined(f, await f.policy.write.setPolicy([f.agent, f.tokenAddress, CAP, DAY]));

      const events = parseEventLogs({ abi: f.policy.abi, logs: receipt.logs, eventName: "PolicySet" });
      expect(events.map((e) => e.args)).to.deep.equal([
        { owner: f.owner, agent: f.agent, token: f.tokenAddress, cap: CAP, period: DAY },
      ]);
      expect(await f.policy.read.policyOf([f.owner, f.agent, f.tokenAddress])).to.deep.equal({
        cap: CAP,
        period: DAY,
        periodStart: timestamp,
        spent: 0n,
        active: true,
      });
    });

    it("allowPayee emits PayeeAllowed and toggles isPayeeAllowed", async function () {
      const f = await loadFixture(deployFixture);
      expect(await f.policy.read.isPayeeAllowed([f.owner, f.agent, f.payee])).to.equal(false);

      const allowed = await mined(f, await f.policy.write.allowPayee([f.agent, f.payee, true]));
      expect(
        parseEventLogs({ abi: f.policy.abi, logs: allowed.receipt.logs, eventName: "PayeeAllowed" }).map((e) => e.args),
      ).to.deep.equal([{ owner: f.owner, agent: f.agent, payee: f.payee, allowed: true }]);
      expect(await f.policy.read.isPayeeAllowed([f.owner, f.agent, f.payee])).to.equal(true);
      // Allowlists are per (owner, agent).
      expect(await f.policy.read.isPayeeAllowed([f.owner, f.stranger, f.payee])).to.equal(false);
      expect(await f.policy.read.isPayeeAllowed([f.stranger, f.agent, f.payee])).to.equal(false);

      const disallowed = await mined(f, await f.policy.write.allowPayee([f.agent, f.payee, false]));
      expect(
        parseEventLogs({ abi: f.policy.abi, logs: disallowed.receipt.logs, eventName: "PayeeAllowed" }).map(
          (e) => e.args,
        ),
      ).to.deep.equal([{ owner: f.owner, agent: f.agent, payee: f.payee, allowed: false }]);
      expect(await f.policy.read.isPayeeAllowed([f.owner, f.agent, f.payee])).to.equal(false);
    });

    it("revoke emits PolicyRevoked and clears the policy", async function () {
      const f = await loadFixture(activePolicyFixture);
      const { receipt } = await mined(f, await f.policy.write.revoke([f.agent, f.tokenAddress]));

      expect(
        parseEventLogs({ abi: f.policy.abi, logs: receipt.logs, eventName: "PolicyRevoked" }).map((e) => e.args),
      ).to.deep.equal([{ owner: f.owner, agent: f.agent, token: f.tokenAddress }]);
      expect(await f.policy.read.policyOf([f.owner, f.agent, f.tokenAddress])).to.deep.equal({
        cap: 0n,
        period: 0n,
        periodStart: 0n,
        spent: 0n,
        active: false,
      });
    });

    it("setPolicy on an existing policy resets spent and the period", async function () {
      const f = await loadFixture(activePolicyFixture);
      await mined(f, await f.policyAsAgent.write.pay([f.owner, f.tokenAddress, f.payee, usd("60"), zeroHash]));
      await time.increase(3_600);

      const newCap = usd("80");
      const { timestamp } = await mined(f, await f.policy.write.setPolicy([f.agent, f.tokenAddress, newCap, 2n * DAY]));
      expect(await f.policy.read.policyOf([f.owner, f.agent, f.tokenAddress])).to.deep.equal({
        cap: newCap,
        period: 2n * DAY,
        periodStart: timestamp,
        spent: 0n,
        active: true,
      });

      // The whole new cap is available straight away, and no more.
      await mined(f, await f.policyAsAgent.write.pay([f.owner, f.tokenAddress, f.payee, newCap, zeroHash]));
      expect(
        await revertOf(f.policyAsAgent.write.pay([f.owner, f.tokenAddress, f.payee, 1n, zeroHash]), f.errorsAbi),
      ).to.deep.equal({ errorName: "CapExceeded", args: [0n, 1n] });
    });

    it("rejects zero addresses and zero limits", async function () {
      const f = await loadFixture(deployFixture);
      const cases = [
        [() => f.policy.write.setPolicy([zeroAddress, f.tokenAddress, CAP, DAY]), "ZeroAddress"],
        [() => f.policy.write.setPolicy([f.agent, zeroAddress, CAP, DAY]), "ZeroAddress"],
        [() => f.policy.write.setPolicy([f.agent, f.tokenAddress, 0n, DAY]), "InvalidLimits"],
        [() => f.policy.write.setPolicy([f.agent, f.tokenAddress, CAP, 0n]), "InvalidLimits"],
        [() => f.policy.write.allowPayee([zeroAddress, f.payee, true]), "ZeroAddress"],
        [() => f.policy.write.allowPayee([f.agent, zeroAddress, true]), "ZeroAddress"],
      ] as const;
      for (const [call, errorName] of cases) {
        expect(await revertOf(call(), f.errorsAbi)).to.deep.equal({ errorName, args: [] });
      }
    });
  });

  describe("pay", function () {
    it("moves tokens from owner to payee within the cap and emits PolicyPaid", async function () {
      const f = await loadFixture(activePolicyFixture);
      const amount = usd("12.34");
      const termsHash = termsHashOf("api-call");
      const ownerBefore = await f.token.read.balanceOf([f.owner]);

      const { receipt } = await mined(
        f,
        await f.policyAsAgent.write.pay([f.owner, f.tokenAddress, f.payee, amount, termsHash]),
      );

      expect(await f.token.read.balanceOf([f.owner])).to.equal(ownerBefore - amount);
      expect(await f.token.read.balanceOf([f.payee])).to.equal(amount);
      expect(await f.token.read.balanceOf([f.policyAddress])).to.equal(0n);

      expect(
        parseEventLogs({ abi: f.policy.abi, logs: receipt.logs, eventName: "PolicyPaid" }).map((e) => e.args),
      ).to.deep.equal([
        { owner: f.owner, agent: f.agent, payee: f.payee, token: f.tokenAddress, amount, termsHash },
      ]);
      expect(
        parseEventLogs({ abi: f.token.abi, logs: receipt.logs, eventName: "Transfer" }).map((e) => e.args),
      ).to.deep.equal([{ from: f.owner, to: f.payee, value: amount }]);

      const after = await f.policy.read.policyOf([f.owner, f.agent, f.tokenAddress]);
      expect(after.spent).to.equal(amount);
      expect(after.periodStart).to.equal(f.periodStart);
    });

    it("reverts with CapExceeded when a payment would go over the cap", async function () {
      const f = await loadFixture(activePolicyFixture);
      const pay = (amount: bigint) =>
        f.policyAsAgent.write.pay([f.owner, f.tokenAddress, f.payee, amount, zeroHash]);

      expect(await revertOf(pay(CAP + 1n), f.errorsAbi)).to.deep.equal({
        errorName: "CapExceeded",
        args: [CAP, CAP + 1n],
      });

      await mined(f, await pay(usd("60")));
      expect(await revertOf(pay(usd("40.01")), f.errorsAbi)).to.deep.equal({
        errorName: "CapExceeded",
        args: [usd("40"), usd("40.01")],
      });

      await mined(f, await pay(usd("40"))); // exactly up to the cap
      expect(await revertOf(pay(1n), f.errorsAbi)).to.deep.equal({ errorName: "CapExceeded", args: [0n, 1n] });
      expect(await f.token.read.balanceOf([f.payee])).to.equal(CAP);
    });

    it("resets spending once the period has passed, keeping periods aligned", async function () {
      const f = await loadFixture(activePolicyFixture);
      const pay = (amount: bigint) =>
        f.policyAsAgent.write.pay([f.owner, f.tokenAddress, f.payee, amount, zeroHash]);
      const policyNow = () => f.policy.read.policyOf([f.owner, f.agent, f.tokenAddress]);

      await mined(f, await pay(CAP));

      // One second before the period ends, the cap is still used up.
      await time.setNextBlockTimestamp(f.periodStart + DAY - 1n);
      expect(await revertOf(pay(1n), f.errorsAbi)).to.deep.equal({ errorName: "CapExceeded", args: [0n, 1n] });

      // From periodStart + period on, a new period applies (policyOf already shows it).
      await time.increaseTo(f.periodStart + DAY);
      expect(await policyNow()).to.deep.include({ periodStart: f.periodStart + DAY, spent: 0n });
      await mined(f, await pay(CAP));
      expect(await policyNow()).to.deep.include({ periodStart: f.periodStart + DAY, spent: CAP });
      expect(await revertOf(pay(1n), f.errorsAbi)).to.deep.equal({ errorName: "CapExceeded", args: [0n, 1n] });

      // After several idle periods, periodStart rolls forward by whole periods.
      await time.setNextBlockTimestamp(f.periodStart + 4n * DAY + 1_234n);
      await mined(f, await pay(usd("1")));
      expect(await policyNow()).to.deep.include({ periodStart: f.periodStart + 4n * DAY, spent: usd("1") });
      expect(await f.token.read.balanceOf([f.payee])).to.equal(2n * CAP + usd("1"));
    });

    it("reverts with PayeeNotAllowed for a payee the owner has not allowed", async function () {
      const f = await loadFixture(activePolicyFixture);

      expect(
        await revertOf(
          f.policyAsAgent.write.pay([f.owner, f.tokenAddress, f.otherPayee, 1n, zeroHash]),
          f.errorsAbi,
        ),
      ).to.deep.equal({ errorName: "PayeeNotAllowed", args: [f.owner, f.agent, f.otherPayee] });

      await mined(f, await f.policy.write.allowPayee([f.agent, f.payee, false]));
      expect(
        await revertOf(f.policyAsAgent.write.pay([f.owner, f.tokenAddress, f.payee, 1n, zeroHash]), f.errorsAbi),
      ).to.deep.equal({ errorName: "PayeeNotAllowed", args: [f.owner, f.agent, f.payee] });
    });

    it("reverts with PolicyInactive without a policy or after revoke", async function () {
      const f = await loadFixture(activePolicyFixture);
      const otherToken = await hre.viem.deployContract("MockERC20", ["Other", "OTH", 18]);
      const otherTokenAddress = getAddress(otherToken.address);

      expect(
        await revertOf(
          f.policyAsAgent.write.pay([f.owner, otherTokenAddress, f.payee, 1n, zeroHash]),
          f.errorsAbi,
        ),
      ).to.deep.equal({ errorName: "PolicyInactive", args: [f.owner, f.agent, otherTokenAddress] });

      await mined(f, await f.policy.write.revoke([f.agent, f.tokenAddress]));
      expect(
        await revertOf(f.policyAsAgent.write.pay([f.owner, f.tokenAddress, f.payee, 1n, zeroHash]), f.errorsAbi),
      ).to.deep.equal({ errorName: "PolicyInactive", args: [f.owner, f.agent, f.tokenAddress] });
      expect(await f.token.read.balanceOf([f.payee])).to.equal(0n);
    });

    it("reverts when the owner has not approved enough tokens", async function () {
      const f = await loadFixture(activePolicyFixture);
      const pay = (amount: bigint) =>
        f.policyAsAgent.write.pay([f.owner, f.tokenAddress, f.payee, amount, zeroHash]);

      await mined(f, await f.token.write.approve([f.policyAddress, 0n]));
      expect(await revertOf(pay(usd("1")), f.errorsAbi)).to.deep.equal({
        errorName: "ERC20InsufficientAllowance",
        args: [f.policyAddress, 0n, usd("1")],
      });

      await mined(f, await f.token.write.approve([f.policyAddress, usd("5")]));
      expect(await revertOf(pay(usd("6")), f.errorsAbi)).to.deep.equal({
        errorName: "ERC20InsufficientAllowance",
        args: [f.policyAddress, usd("5"), usd("6")],
      });

      // A failed transfer leaves the policy's spending untouched.
      expect((await f.policy.read.policyOf([f.owner, f.agent, f.tokenAddress])).spent).to.equal(0n);
      await mined(f, await pay(usd("5")));
      expect(await f.token.read.balanceOf([f.payee])).to.equal(usd("5"));
    });

    it("only lets the agent named in the policy spend", async function () {
      const f = await loadFixture(activePolicyFixture);

      expect(
        await revertOf(
          f.policyAsStranger.write.pay([f.owner, f.tokenAddress, f.payee, 1n, zeroHash]),
          f.errorsAbi,
        ),
      ).to.deep.equal({ errorName: "PolicyInactive", args: [f.owner, f.stranger, f.tokenAddress] });

      // Not even the owner can spend through the agent's policy.
      expect(
        await revertOf(f.policy.write.pay([f.owner, f.tokenAddress, f.payee, 1n, zeroHash]), f.errorsAbi),
      ).to.deep.equal({ errorName: "PolicyInactive", args: [f.owner, f.owner, f.tokenAddress] });

      // A policy of its own does not give the stranger the agent's payees.
      await mined(f, await f.policy.write.setPolicy([f.stranger, f.tokenAddress, CAP, DAY]));
      expect(
        await revertOf(
          f.policyAsStranger.write.pay([f.owner, f.tokenAddress, f.payee, 1n, zeroHash]),
          f.errorsAbi,
        ),
      ).to.deep.equal({ errorName: "PayeeNotAllowed", args: [f.owner, f.stranger, f.payee] });
      expect(await f.token.read.balanceOf([f.payee])).to.equal(0n);
    });

    it("reverts with ZeroAmount for a zero amount", async function () {
      const f = await loadFixture(activePolicyFixture);
      expect(
        await revertOf(f.policyAsAgent.write.pay([f.owner, f.tokenAddress, f.payee, 0n, zeroHash]), f.errorsAbi),
      ).to.deep.equal({ errorName: "ZeroAmount", args: [] });
    });

    it("blocks a token that re-enters pay()", async function () {
      const f = await loadFixture(activePolicyFixture);
      const evil = await hre.viem.deployContract("ReentrantERC20");
      const evilAddress = getAddress(evil.address);
      await evil.write.mint([f.owner, usd("1000")]);
      await evil.write.approve([f.policyAddress, maxUint256]);
      await f.policy.write.setPolicy([f.agent, evilAddress, CAP, DAY]);
      // Give the token itself a valid policy too, so only the reentrancy guard can stop the nested call.
      await f.policy.write.setPolicy([evilAddress, evilAddress, CAP, DAY]);
      await f.policy.write.allowPayee([evilAddress, f.payee, true]);

      // Unarmed, the token behaves normally.
      await mined(f, await f.policyAsAgent.write.pay([f.owner, evilAddress, f.payee, 1n, zeroHash]));

      await evil.write.arm([f.policyAddress, f.owner, f.payee, 1n]);
      expect(
        await revertOf(f.policyAsAgent.write.pay([f.owner, evilAddress, f.payee, 1n, zeroHash]), f.errorsAbi),
      ).to.deep.equal({ errorName: "ReentrancyGuardReentrantCall", args: [] });
      expect(await evil.read.balanceOf([f.payee])).to.equal(1n);
    });

    it("does not overflow with the largest cap, period and amount", async function () {
      const f = await loadFixture(deployFixture);
      const pay = (amount: bigint) =>
        f.policyAsAgent.write.pay([f.owner, f.tokenAddress, f.payee, amount, zeroHash]);
      await f.token.write.mint([f.owner, maxUint128]);
      await f.policy.write.allowPayee([f.agent, f.payee, true]);
      await f.policy.write.setPolicy([f.agent, f.tokenAddress, maxUint128, maxUint64]);

      // periodStart + period exceeds 64 bits; amounts above the cap revert cleanly instead of panicking.
      expect(await revertOf(pay(maxUint256), f.errorsAbi)).to.deep.equal({
        errorName: "CapExceeded",
        args: [maxUint128, maxUint256],
      });
      await mined(f, await pay(maxUint128 - 1n));
      await time.increase(100n * 365n * DAY);
      await mined(f, await pay(1n));
      expect(await revertOf(pay(1n), f.errorsAbi)).to.deep.equal({ errorName: "CapExceeded", args: [0n, 1n] });
      expect((await f.policy.read.policyOf([f.owner, f.agent, f.tokenAddress])).spent).to.equal(maxUint128);
    });
  });
});
