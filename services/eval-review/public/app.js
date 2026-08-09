const state = {
  token: '',
  session: null,
  items: [],
  selectedId: null,
  selectionGeneration: 0,
  objectUrls: [],
};

function readToken() {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get('token') || sessionStorage.getItem('operatingline.evalReviewToken');
  if (!token) throw new Error('缺少本地审核会话 Token，请使用启动命令输出的完整 URL。');
  sessionStorage.setItem('operatingline.evalReviewToken', token);
  history.replaceState(null, '', window.location.pathname);
  return token;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      authorization: `Bearer ${state.token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    let message = `本地请求失败（HTTP ${response.status}）`;
    try {
      const error = await response.json();
      if (error.message) message = error.message;
    } catch {
      // Preserve the status-only fallback without exposing response bodies.
    }
    throw new Error(message);
  }
  return response;
}

function notice(message, isError = false) {
  const element = document.querySelector('#notice');
  element.textContent = message;
  element.className = `notice visible${isError ? ' error' : ''}`;
  window.setTimeout(() => {
    element.className = 'notice';
  }, 4200);
}

function clearObjectUrls() {
  for (const url of state.objectUrls) URL.revokeObjectURL(url);
  state.objectUrls = [];
}

function element(tag, properties = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(properties)) {
    if (key === 'className') node.className = value;
    else if (key === 'textContent') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

function itemState(item) {
  if (state.session.role === 'adjudicator') return '存在待裁决分歧';
  return item.ownStatus.state === 'submitted' ? '已提交，可追加更正' : '尚未提交';
}

function renderQueue() {
  const container = document.querySelector('#items');
  container.replaceChildren();
  if (state.items.length === 0) {
    container.append(
      element('p', {
        className: 'muted',
        textContent:
          state.session.role === 'adjudicator' ? '当前没有待裁决分歧。' : '当前没有可审核 Run。',
      }),
    );
    return;
  }
  for (const item of state.items) {
    container.append(
      element(
        'button',
        {
          type: 'button',
          className: 'item-button',
          'aria-current': String(state.selectedId === item.opaqueRunId),
          onclick: () => void selectItem(item.opaqueRunId),
        },
        [
          element('strong', { textContent: item.title }),
          element('span', { textContent: itemState(item) }),
        ],
      ),
    );
  }
}

function jsonCard(title, value) {
  return element('section', { className: 'card' }, [
    element('h3', { textContent: title }),
    element('pre', { textContent: JSON.stringify(value, null, 2) }),
  ]);
}

async function artifactCards(item, generation) {
  const cards = [];
  const objectUrls = [];
  const images = item.evidenceOptions.filter((option) => option.mediaType === 'image/png');
  for (const image of images) {
    const response = await api(`/api/v1/artifacts/${encodeURIComponent(image.token)}`);
    const url = URL.createObjectURL(await response.blob());
    objectUrls.push(url);
    if (generation !== state.selectionGeneration) {
      for (const staleUrl of objectUrls) URL.revokeObjectURL(staleUrl);
      return { cards: [], objectUrls: [] };
    }
    cards.push(
      element('section', { className: 'card' }, [
        element('h3', { textContent: image.label }),
        element('img', { className: 'artifact-preview', src: url, alt: image.label }),
      ]),
    );
  }
  return { cards, objectUrls };
}

function annotationCards(item) {
  if (!item.annotations) return [];
  return [
    element('section', { className: 'card' }, [
      element('h3', { textContent: '保留的独立判断' }),
      element(
        'div',
        { className: 'annotations' },
        item.annotations.map((annotation) =>
          element('article', { className: 'annotation' }, [
            element('strong', { textContent: annotation.label }),
            element('p', { textContent: `建议：${annotation.recommendation}` }),
            ...annotation.judgments.map((judgment) =>
              element('p', {
                textContent: `${judgment.criterionId} · ${judgment.judgment} — ${judgment.rationale}`,
              }),
            ),
          ]),
        ),
      ),
    ]),
  ];
}

const judgmentLabels = {
  met: '满足',
  partially_met: '部分满足',
  not_met: '不满足',
  unable_to_judge: '证据不足，无法判断',
  not_applicable: '不适用',
};

function reviewForm(item) {
  const form = element('form', { className: 'review-form' });
  const criteria = element('div', { className: 'criteria' });
  for (const criterion of item.rubric) {
    const judgment = element('select', { name: `judgment:${criterion.id}`, required: 'required' });
    for (const [value, label] of Object.entries(judgmentLabels)) {
      judgment.append(element('option', { value, textContent: label }));
    }
    const rationale = element('textarea', {
      name: `rationale:${criterion.id}`,
      required: 'required',
      minlength: '1',
      maxlength: '4000',
      placeholder: '说明你的判断依据；不要猜测未提供的执行或视觉结果。',
    });
    const evidenceOptions = item.evidenceOptions.filter((option) =>
      criterion.evidenceKinds.includes(option.kind),
    );
    const evidence = element('fieldset', { className: 'evidence' }, [
      element('legend', { textContent: '证据（至少选择一项）' }),
      ...evidenceOptions.map((option, index) => {
        const id = `evidence-${criterion.id}-${index}`;
        return element('label', { className: 'evidence-option', for: id }, [
          element('input', {
            id,
            type: 'checkbox',
            name: `evidence:${criterion.id}`,
            value: option.token,
            'data-label': option.label,
          }),
          element('span', { textContent: `${option.kind} · ${option.label}` }),
        ]);
      }),
    ]);
    criteria.append(
      element('article', { className: 'criterion' }, [
        element('h3', { textContent: criterion.title }),
        element('p', { textContent: criterion.question }),
        element('p', { textContent: criterion.guidance }),
        element('label', { className: 'field' }, [
          element('span', { textContent: '判断' }),
          judgment,
        ]),
        element('label', { className: 'field' }, [
          element('span', { textContent: '理由' }),
          rationale,
        ]),
        evidence,
      ]),
    );
  }
  form.append(criteria);

  const recommendation = element('select', { name: 'recommendation' }, [
    element('option', { value: 'accept', textContent: '接受' }),
    element('option', { value: 'revise', textContent: '需要修订' }),
    element('option', { value: 'unable_to_judge', textContent: '无法判断' }),
  ]);
  const submitChildren = [];
  if (state.session.role === 'reviewer') {
    submitChildren.push(
      element('label', { className: 'field' }, [
        element('span', { textContent: '总体建议' }),
        recommendation,
      ]),
    );
  }
  submitChildren.push(
    element('button', {
      type: 'submit',
      className: 'primary',
      textContent:
        state.session.role === 'adjudicator'
          ? '保存裁决'
          : item.ownStatus.state === 'submitted'
            ? '追加更正记录'
            : '提交独立审核',
    }),
  );
  form.append(element('div', { className: 'submit-row' }, submitChildren));
  form.addEventListener('submit', (event) => void submitReview(event, item, form));
  return form;
}

async function submitReview(event, item, form) {
  event.preventDefault();
  try {
    const judgments = item.rubric.map((criterion) => {
      const checked = [
        ...form.querySelectorAll(`input[name="evidence:${CSS.escape(criterion.id)}"]:checked`),
      ];
      if (checked.length === 0) throw new Error(`“${criterion.title}”至少需要一项证据。`);
      const rationale = form.elements.namedItem(`rationale:${criterion.id}`).value.trim();
      if (!rationale) throw new Error(`“${criterion.title}”需要填写理由。`);
      return {
        criterionId: criterion.id,
        judgment: form.elements.namedItem(`judgment:${criterion.id}`).value,
        rationale,
        evidence: checked.map((input) => ({
          token: input.value,
          note: `Reviewed blinded evidence: ${input.dataset.label}`,
        })),
      };
    });
    const body = { versionToken: item.versionToken, judgments };
    let path;
    if (state.session.role === 'reviewer') {
      body.recommendation = form.elements.namedItem('recommendation').value;
      if (item.ownStatus.state === 'submitted') {
        body.supersedesAnnotationToken = item.ownStatus.annotationToken;
      }
      path = `/api/v1/items/${encodeURIComponent(item.opaqueRunId)}/annotation`;
    } else {
      path = `/api/v1/items/${encodeURIComponent(item.opaqueRunId)}/adjudication`;
    }
    await api(path, { method: 'POST', body: JSON.stringify(body) });
    notice(state.session.role === 'reviewer' ? '审核记录已不可变写入。' : '裁决记录已不可变写入。');
    await loadItems();
  } catch (error) {
    notice(error instanceof Error ? error.message : String(error), true);
  }
}

async function renderDetail(item, generation) {
  const detail = document.querySelector('#detail');
  const requirements = element(
    'ul',
    { className: 'requirements' },
    item.requirements.map((requirement) =>
      element('li', {
        className: 'requirement',
        textContent: `${requirement.importance.toUpperCase()} · ${requirement.statement}`,
      }),
    ),
  );
  const children = [
    element('section', { className: 'review-header' }, [
      element('p', { className: 'eyebrow', textContent: 'PROVIDER-BLIND · NO NUMERIC SCORE' }),
      element('h2', { textContent: item.title }),
      element('p', { textContent: item.task }),
    ]),
    element('section', { className: 'card' }, [
      element('h3', { textContent: '验收要求' }),
      requirements,
    ]),
    ...annotationCards(item),
  ];
  if (item.generatedPlan) children.push(jsonCard('生成计划', item.generatedPlan));
  if (item.planningQuality) children.push(jsonCard('确定性质量证据', item.planningQuality));
  const artifacts = await artifactCards(item, generation);
  if (generation !== state.selectionGeneration) {
    for (const url of artifacts.objectUrls) URL.revokeObjectURL(url);
    return;
  }
  children.push(...artifacts.cards, reviewForm(item));
  clearObjectUrls();
  state.objectUrls = artifacts.objectUrls;
  detail.replaceChildren(...children);
}

async function selectItem(opaqueRunId) {
  const generation = state.selectionGeneration + 1;
  state.selectionGeneration = generation;
  try {
    state.selectedId = opaqueRunId;
    renderQueue();
    const response = await api(`/api/v1/items/${encodeURIComponent(opaqueRunId)}`);
    if (generation !== state.selectionGeneration) return;
    await renderDetail(await response.json(), generation);
  } catch (error) {
    if (generation === state.selectionGeneration) notice(error.message, true);
  }
}

async function loadItems() {
  const response = await api('/api/v1/items');
  state.items = await response.json();
  const prior = state.selectedId;
  state.selectionGeneration += 1;
  state.selectedId = null;
  renderQueue();
  if (prior && state.items.some((item) => item.opaqueRunId === prior)) await selectItem(prior);
}

async function start() {
  state.token = readToken();
  const sessionResponse = await api('/api/v1/session');
  state.session = await sessionResponse.json();
  document.querySelector('#session').textContent =
    `${state.session.role === 'reviewer' ? 'Reviewer' : 'Adjudicator'} · Provider identity hidden`;
  document.querySelector('#refresh').addEventListener('click', () => {
    void loadItems().catch((error) => notice(error.message, true));
  });
  await loadItems();
}

void start().catch((error) => notice(error.message, true));
