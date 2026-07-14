import { describe, expect, it } from "vitest";
import {
  chooseStudioModel,
  describeStudioModel,
} from "./assistant-models";

describe("catálogo de modelos do Estúdio", () => {
  it("prefere DeepSeek e preserva o ID exato retornado pela API", () => {
    expect(
      chooseStudioModel(
        ["pro/glm-4.7-flash", "pro/deepseek-v4-flash"],
        null,
      ),
    ).toBe("pro/deepseek-v4-flash");
  });

  it("exibe nome e janela conhecidos mesmo com prefixo do provedor", () => {
    expect(describeStudioModel("pro/qwen3.6-27b")).toEqual({
      id: "pro/qwen3.6-27b",
      label: "Qwen 3.6 27B",
      contextWindow: 262_144,
    });
  });
});
