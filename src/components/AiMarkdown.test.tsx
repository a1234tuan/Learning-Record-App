import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AiMarkdown } from "./AiMarkdown";

describe("AiMarkdown", () => {
  it("renders inline and block math with KaTeX", () => {
    const { container } = render(
      <AiMarkdown content={"行内公式 $a^2+b^2=c^2$\n\n$$\n\\int_0^1 x^2\\,dx\n$$"} />,
    );

    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    expect(container).not.toHaveTextContent("$$");
  });

  it("renders GitHub-flavored Markdown tables", () => {
    render(<AiMarkdown content={"| 项 | 值 |\n| --- | --- |\n| 公式 | $x^2$ |"} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("公式")).toBeInTheDocument();
  });

  it("renders fenced code blocks", () => {
    const { container } = render(<AiMarkdown content={"```ts\nconst answer = 408;\n```"} />);

    expect(container.querySelector("pre code")).toHaveTextContent("const answer = 408;");
  });

  it("keeps the message readable when a formula is invalid", () => {
    const { container } = render(<AiMarkdown content={"公式可能写错：$\\definitelyNotACommand$，但正文不能崩。"} />);

    expect(container).toHaveTextContent("正文不能崩");
  });
});
