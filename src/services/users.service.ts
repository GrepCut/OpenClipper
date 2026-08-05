import { apiClient } from "../shared/utils/api-client.util";

export const usersService = {
  deleteAccount: (payload: { confirmation: "DELETE" }) =>
    apiClient
      .delete<void>("/users/me", { data: payload })
      .then((res) => res.data),
};
