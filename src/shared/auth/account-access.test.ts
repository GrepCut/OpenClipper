import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "../stores/useAuthStore";
import {
  AccountRequiredError,
  accountState,
  hasOnlineAccountAccess,
  requireOnlineAccount,
} from "./account-access";

describe("account feature access", () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      token: null,
      isAuthenticated: false,
      hasTriedInit: true,
      isLoading: false,
      isLoggingOut: false,
      sessionMode: null,
    });
  });

  it("keeps the local app available in guest state", () => {
    expect(accountState()).toBe("guest");
    expect(hasOnlineAccountAccess()).toBe(false);
    expect(() => requireOnlineAccount()).toThrow(AccountRequiredError);
  });

  it("reports checking while auth initializes", () => {
    useAuthStore.setState({ hasTriedInit: false });
    expect(accountState()).toBe("checking");
  });
});
